/**
 * 按赛道关键词搜索候选文章 + 正文抽取
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../../models/db');
const browserService = require('../browser-service');

const DOMAIN_BLACKLIST = [
  'javascript:',
  'chrome://',
  'login.',
  'passport.',
  'account.',
  'ads.',
  'taobao.com',
  'tmall.com',
  'jd.com',
];

function isBadUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  const lower = url.toLowerCase();
  return DOMAIN_BLACKLIST.some((b) => lower.includes(b));
}

async function safeEvaluate(page, fn, arg, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      // 等导航稳定，避免 “Execution context was destroyed”
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await browserService.humanDelay(800, 1200);
      return await page.evaluate(fn, arg);
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      if (msg.includes('Execution context was destroyed') || msg.includes('navigation')) {
        await browserService.humanDelay(1000, 1500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function searchBing(page, query, limit = 8) {
  const q = encodeURIComponent(query);
  await page.goto(`https://www.bing.com/search?q=${q}&setlang=zh-CN&mkt=zh-CN`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await browserService.humanDelay(2500, 4000);
  // 等结果节点；没有也不抛，后面走百度
  await page.waitForSelector('#b_results li.b_algo, #b_results .b_algo', { timeout: 12000 }).catch(() => {});

  return safeEvaluate(page, (max) => {
    const results = [];
    const nodes = document.querySelectorAll('#b_results > li.b_algo, #b_results li.b_algo');
    nodes.forEach((li) => {
      if (results.length >= max) return;
      const a = li.querySelector('h2 a');
      const sn = li.querySelector('.b_caption p, .b_lineclamp2, .b_algoSlug');
      const title = (a?.innerText || a?.textContent || '').trim();
      const url = a?.href || '';
      const snippet = (sn?.innerText || sn?.textContent || '').trim();
      if (title && url) results.push({ title, url, snippet });
    });
    return results;
  }, limit);
}

async function searchBaidu(page, query, limit = 8) {
  const q = encodeURIComponent(query);
  await page.goto(`https://www.baidu.com/s?wd=${q}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await browserService.humanDelay(2500, 4000);
  await page.waitForSelector('#content_left .result, #content_left .c-container', { timeout: 12000 }).catch(() => {});

  return safeEvaluate(page, (max) => {
    const results = [];
    document.querySelectorAll('#content_left .result, #content_left .c-container').forEach((el) => {
      if (results.length >= max) return;
      const a = el.querySelector('h3 a, a');
      const title = (a?.innerText || '').trim();
      let url = a?.href || '';
      // 百度跳转链也可能可用
      const sn = el.querySelector('.c-abstract, .content-right_8Zs40, .c-span-last');
      const snippet = (sn?.innerText || '').trim();
      if (title && url) results.push({ title, url, snippet });
    });
    return results;
  }, limit);
}

async function extractBody(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await browserService.humanDelay(1000, 2000);
    const text = await page.evaluate(() => {
      const drop = (root) => {
        root.querySelectorAll('script,style,nav,footer,header,aside,iframe,noscript').forEach((n) => n.remove());
      };
      const article =
        document.querySelector('article') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('.Post-RichText') ||
        document.querySelector('.rich_media_content') ||
        document.querySelector('.article-content') ||
        document.querySelector('#content') ||
        document.querySelector('main') ||
        document.body;

      const clone = article.cloneNode(true);
      drop(clone);
      let t = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
      if (t.length < 80) {
        t = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
      }
      // 截断
      return t.slice(0, 8000);
    });
    if (text && text.length >= 80) {
      return { body: text, body_status: 'full' };
    }
    return { body: text || '', body_status: text ? 'partial' : 'failed' };
  } catch {
    return { body: '', body_status: 'failed' };
  }
}

/**
 * 搜索并入库
 * @param {{ id: string, title: string, queries?: string[] }} topic
 *   topic.id 用作 topic_id（热词 id 或 niche:xxx）
 *   topic.queries 可选：多关键词轮询搜索（垂直赛道）
 */
async function searchAndSaveArticles(topic, { force = false } = {}) {
  // 5 分钟内同 topic 不重复抓（除非 force）
  if (!force) {
    const recent = db.prepare(`
      SELECT COUNT(*) AS c FROM source_articles
      WHERE topic_id = ? AND created_at > datetime('now', '-5 minutes')
    `).get(topic.id);
    if (recent?.c > 0) {
      const articles = db.prepare(`
        SELECT * FROM source_articles WHERE topic_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(topic.id);
      return { articles, cached: true };
    }
  }

  const queries = (topic.queries && topic.queries.length)
    ? topic.queries
    : [topic.title];

  const context = await browserService.createContext(`search_${Date.now()}`, { headless: true });
  const page = await context.newPage();
  let engine = 'bing';
  /** @type {Array<{title:string,url:string,snippet:string}>} */
  let raw = [];
  const seenUrls = new Set();

  try {
    for (const q of queries.slice(0, 4)) {
      console.log(`[Search] 查询: ${q}`);
      let batch = [];
      try {
        batch = await searchBing(page, q, 6);
        if (batch.length) engine = 'bing';
      } catch (err) {
        console.warn('[Search] Bing 失败:', err.message);
        batch = [];
      }
      if (!batch.length) {
        try {
          batch = await searchBaidu(page, q, 6);
          if (batch.length) engine = 'baidu';
        } catch (err) {
          console.warn('[Search] 百度失败:', err.message);
          batch = [];
        }
      }
      for (const item of batch) {
        if (!item.url || seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        raw.push(item);
      }
      if (raw.length >= 10) break;
    }

    const filtered = raw.filter((r) => !isBadUrl(r.url)).slice(0, 8);
    if (filtered.length === 0) {
      console.warn('[Search] 无搜索结果，使用话题占位素材');
      const id = uuidv4();
      const placeholderTitle = `${topic.title}：观察与思考`;
      const placeholderBody =
        `赛道/话题「${topic.title}」。` +
        `请围绕该人群真实痛点撰写公众号图文，结合常见生活与职场场景，不要编造具体数据。`;
      db.prepare(`
        INSERT INTO source_articles
          (id, topic_id, topic_title, title, url, snippet, body, body_status, search_engine)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        topic.id,
        topic.title,
        placeholderTitle,
        `https://www.bing.com/search?q=${encodeURIComponent(queries[0] || topic.title)}`,
        placeholderBody,
        placeholderBody,
        'partial',
        'fallback'
      );
      const articles = [db.prepare('SELECT * FROM source_articles WHERE id = ?').get(id)];
      return {
        articles,
        cached: false,
        search_engine: 'fallback',
        queries,
        warning: '搜索无结果，已用话题占位素材',
      };
    }

    const extractCount = Math.min(3, filtered.length);
    const articles = [];

    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      let body = '';
      let body_status = 'partial';
      if (i < extractCount) {
        console.log(`[Search] 抽取正文 ${i + 1}/${extractCount}: ${item.title.slice(0, 30)}`);
        try {
          const ext = await extractBody(page, item.url);
          body = ext.body;
          body_status = body ? ext.body_status : 'failed';
        } catch (err) {
          console.warn('[Search] 正文抽取失败:', err.message);
          body_status = 'failed';
        }
        if (!body && item.snippet) {
          body = item.snippet;
          body_status = 'partial';
        }
      } else if (item.snippet) {
        body = item.snippet;
        body_status = 'partial';
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO source_articles
          (id, topic_id, topic_title, title, url, snippet, body, body_status, search_engine)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        topic.id,
        topic.title,
        item.title,
        item.url,
        item.snippet || '',
        body,
        body_status,
        engine
      );

      articles.push(
        db.prepare('SELECT * FROM source_articles WHERE id = ?').get(id)
      );
    }

    return { articles, cached: false, search_engine: engine, queries };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function listArticlesByTopic(topicId) {
  return db.prepare(`
    SELECT * FROM source_articles WHERE topic_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(topicId);
}

function getArticleById(id) {
  return db.prepare('SELECT * FROM source_articles WHERE id = ?').get(id);
}

module.exports = {
  searchAndSaveArticles,
  listArticlesByTopic,
  getArticleById,
};
