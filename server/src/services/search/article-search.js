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

async function searchBing(page, query, limit = 8) {
  const q = encodeURIComponent(query);
  await page.goto(`https://www.bing.com/search?q=${q}&setlang=zh-CN`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await browserService.humanDelay(2000, 3000);

  return page.evaluate((max) => {
    const results = [];
    const nodes = document.querySelectorAll('#b_results > li.b_algo');
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
 * @param {{ id: string, title: string }} topic
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

  const context = await browserService.createContext(`search_${Date.now()}`, { headless: true });
  const page = await context.newPage();
  let engine = 'bing';
  let raw = [];

  try {
    raw = await searchBing(page, topic.title, 8);
    if (!raw.length) {
      // 简单百度兜底
      engine = 'baidu';
      const q = encodeURIComponent(topic.title);
      await page.goto(`https://www.baidu.com/s?wd=${q}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await browserService.humanDelay(2000, 3000);
      raw = await page.evaluate((max) => {
        const results = [];
        document.querySelectorAll('#content_left .result, #content_left .c-container').forEach((el) => {
          if (results.length >= max) return;
          const a = el.querySelector('h3 a, a');
          const title = (a?.innerText || '').trim();
          const url = a?.href || '';
          const sn = el.querySelector('.c-abstract, .content-right_8Zs40');
          const snippet = (sn?.innerText || '').trim();
          if (title && url) results.push({ title, url, snippet });
        });
        return results;
      }, 8);
    }

    const filtered = raw.filter((r) => !isBadUrl(r.url)).slice(0, 8);
    const extractCount = Math.min(3, filtered.length);
    const articles = [];

    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      let body = '';
      let body_status = 'partial';
      if (i < extractCount) {
        console.log(`[Search] 抽取正文 ${i + 1}/${extractCount}: ${item.title.slice(0, 30)}`);
        const ext = await extractBody(page, item.url);
        body = ext.body;
        body_status = body ? ext.body_status : 'failed';
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

    return { articles, cached: false, search_engine: engine };
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
