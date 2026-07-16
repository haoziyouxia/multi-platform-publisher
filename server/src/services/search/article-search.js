/**
 * 按赛道关键词搜索候选文章 + 正文抽取
 * - 提高拉取量（多查询 / 多结果 / 多正文抽取）
 * - 屏蔽广告、引流、卖课、加微信等垃圾内容
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../../models/db');
const browserService = require('../browser-service');

/** 搜索规模（可用 env 覆盖） */
const SEARCH_QUERY_LIMIT = Number(process.env.SEARCH_QUERY_LIMIT || 6);
const SEARCH_PER_ENGINE = Number(process.env.SEARCH_PER_ENGINE || 12);
const SEARCH_RAW_CAP = Number(process.env.SEARCH_RAW_CAP || 40);
const SEARCH_RESULT_LIMIT = Number(process.env.SEARCH_RESULT_LIMIT || 20);
const SEARCH_EXTRACT_COUNT = Number(process.env.SEARCH_EXTRACT_COUNT || 8);
const SEARCH_LIST_LIMIT = Number(process.env.SEARCH_LIST_LIMIT || 40);

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
  'pinduoduo.com',
  'yangkeduo.com',
  '1688.com',
  'alibaba.com',
  'suning.com',
  'vip.com',
  'kaola.com',
  // 明显非中文内容站 / 噪音
  'microsoft.com',
  'apple.com',
  'wikipedia.org',
  'amazon.com',
  'reddit.com',
  'youtube.com',
  'tacobell.com',
  // 广告 / 招商 / 导购联盟
  'smzdm.com/p/',
  'duomai.com',
  'linkstars.com',
  'click.',
  'track.',
  'aff.',
];

/** 中文内容站优先（用于排序加权） */
const ZH_DOMAIN_BONUS = [
  'zhihu.com',
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'jianshu.com',
  'toutiao.com',
  'sohu.com',
  '163.com',
  'qq.com',
  'sina.com',
  'ifeng.com',
  '36kr.com',
  'sspai.com',
  'douban.com',
  'bilibili.com',
  'csdn.net',
  'cnblogs.com',
  'baidu.com',
  'thepaper.cn',
  'caixin.com',
  'yicai.com',
  'cls.cn',
  'xueqiu.com',
  'huxiu.com',
  'guokr.com',
];

/**
 * 广告 / 引流 / 卖课话术关键词（命中标题或摘要即屏蔽）
 * 注意：避免误伤正常「副业赚钱经验」类干货，尽量用强意图词
 */
const SPAM_KEYWORDS = [
  // 引流私域
  '加微信', '加我微信', '加v', '加V', '加薇', '加威信', '私信领取',
  '扫码加', '扫码进群', '扫码咨询', '扫一扫', '二维码',
  'vx同号', 'VX同号', '薇信', '威信同号', '微信同号',
  '进群领取', '拉你进群', '免费进群', '粉丝群', '交流群',
  '关注公众号回复', '后台回复', '私聊我', '扣1领取',
  // 广告推销
  '限时优惠', '限时特价', '点击领取', '免费领取', '0元领取',
  '立即购买', '马上抢购', '下单立减', '买一送一', '全网最低',
  '代理招商', '招代理', '加盟费', '一件代发', '微商',
  '刷单', '日入过万', '月入三万', '月入十万', '躺赚',
  '稳赚不赔', '保本保息', '内幕消息',
  // 卖课 / 知识付费硬广
  '课程优惠', '训练营报名', '名额有限', '抢报', '早鸟价',
  '报名立减', '名师带学', '内部名额',
  // 导流站 / 软广套路
  '点击下方', '链接在评论', '评论区领取', '主页领取',
  '免费送你', '送你一份', '资料包领取', '资料免费领',
  '添加客服', '联系客服', '咨询客服', '在线客服',
  // 明显广告标题模板
  '亲测有效', '小白一天', '有手就行', '冷门赛道日入',
  '暴利项目', '躺着赚钱', '轻松月入',
];

const SPAM_REGEXES = [
  /加\s*[vVwW微薇威]/,
  /v\s*信|vx|VX|ＶＸ/,
  /微信[：:\s]*[a-zA-Z0-9_-]{5,}/,
  /日入\s*\d+/,
  /月入\s*\d+/,
  /【广告】|\[广告\]|赞助内容|推广信息/,
  /免费领(取|资料|课)/,
  /(训练营|系统课|付费课|网课).{0,8}(报名|优惠|名额)/,
  /扫码.{0,6}(进群|加|领|咨询)/,
  /点击(链接|蓝字|下方)/,
  /原价.{0,12}现价/,
];

function isBadUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  const lower = url.toLowerCase();
  return DOMAIN_BLACKLIST.some((b) => lower.includes(b));
}

/**
 * 是否广告 / 引流垃圾（标题 + 摘要 + URL 文本）
 * @returns {{ spam: boolean, reason?: string }}
 */
function detectSpam(item) {
  const title = String(item?.title || '');
  const snippet = String(item?.snippet || '');
  const url = String(item?.url || '');
  const text = `${title}\n${snippet}\n${url}`;

  for (const kw of SPAM_KEYWORDS) {
    if (text.includes(kw)) {
      return { spam: true, reason: `关键词:${kw}` };
    }
  }
  for (const re of SPAM_REGEXES) {
    if (re.test(text)) {
      return { spam: true, reason: `规则:${re}` };
    }
  }

  // 标题极短且全是促销符号
  if (/[!！]{2,}/.test(title) && /领|抢|赚|免费|加/.test(title)) {
    return { spam: true, reason: '促销标题' };
  }

  return { spam: false };
}

function isSpamResult(item) {
  return detectSpam(item).spam;
}

/**
 * 是否像中文标题/摘要（垂直赛道面向中文公众号，过滤英文垃圾结果）
 */
function looksChinese(text) {
  if (!text) return false;
  const s = String(text);
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  // 至少 4 个汉字，且汉字不少于英文字母的一半（避免纯英文）
  return zh >= 4 && zh >= letters * 0.5;
}

function isChineseResult(item) {
  return looksChinese(item.title) || looksChinese(item.snippet);
}

function domainBonus(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (ZH_DOMAIN_BONUS.some((d) => host.endsWith(d))) return 2;
    if (host.endsWith('.cn') || host.endsWith('.com.cn')) return 1;
  } catch { /* ignore */ }
  return 0;
}

function rankChineseResults(items) {
  return [...items].sort((a, b) => {
    const sa = (looksChinese(a.title) ? 3 : 0) + (looksChinese(a.snippet) ? 1 : 0) + domainBonus(a.url);
    const sb = (looksChinese(b.title) ? 3 : 0) + (looksChinese(b.snippet) ? 1 : 0) + domainBonus(b.url);
    return sb - sa;
  });
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

/**
 * 百度优先：中文垂直赛道（中年男人等）必须走中文搜索
 * 查询词自动加「中文内容」约束，减少英文站噪音
 */
function toChineseQuery(query) {
  const q = String(query || '').trim();
  // 已是中文关键词则再补站点偏好
  if (/[\u4e00-\u9fff]/.test(q)) {
    return `${q} 公众号 OR 知乎 OR 经验`;
  }
  return `${q} 中文`;
}

function filterSearchHits(raw, limit) {
  return rankChineseResults(
    raw
      .filter(isChineseResult)
      .filter((item) => !isSpamResult(item))
      .filter((item) => !isBadUrl(item.url))
  ).slice(0, limit);
}

async function searchBaidu(page, query, limit = SEARCH_PER_ENGINE) {
  const q = encodeURIComponent(toChineseQuery(query));
  // rn 多取，过滤英文 / 广告后再截断
  const rn = Math.min(50, Math.max(20, limit * 3));
  await page.goto(`https://www.baidu.com/s?wd=${q}&rn=${rn}&ie=utf-8`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await browserService.humanDelay(2500, 4000);
  await page.waitForSelector('#content_left .result, #content_left .c-container', { timeout: 15000 }).catch(() => {});

  const raw = await safeEvaluate(page, (max) => {
    const results = [];
    document.querySelectorAll('#content_left .result, #content_left .c-container').forEach((el) => {
      if (results.length >= max) return;
      const a = el.querySelector('h3 a, a[href]');
      const title = (a?.innerText || a?.textContent || '').trim();
      const url = a?.href || '';
      const sn = el.querySelector('.c-abstract, .content-right_8Zs40, .c-span-last, .c-color-text');
      const snippet = (sn?.innerText || sn?.textContent || '').trim();
      if (title && url) results.push({ title, url, snippet });
    });
    return results;
  }, Math.max(limit * 3, 24));

  return filterSearchHits(raw, limit);
}

async function searchBing(page, query, limit = SEARCH_PER_ENGINE) {
  // 强制中文区 + 简体界面；query 带中文约束；多页拼接
  const q = encodeURIComponent(toChineseQuery(query));
  const pagesToFetch = limit > 10 ? 2 : 1;
  let raw = [];

  for (let pageIdx = 0; pageIdx < pagesToFetch; pageIdx++) {
    const first = pageIdx * 10 + 1;
    await page.goto(
      `https://cn.bing.com/search?q=${q}&setlang=zh-Hans&mkt=zh-CN&cc=CN&ensearch=0&first=${first}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      }
    );
    await browserService.humanDelay(2000, 3500);
    await page.waitForSelector('#b_results li.b_algo, #b_results .b_algo', { timeout: 12000 }).catch(() => {});

    const batch = await safeEvaluate(page, (max) => {
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
    }, 15);
    raw = raw.concat(batch || []);
  }

  return filterSearchHits(raw, limit);
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
      const articles = listArticlesByTopic(topic.id);
      // 缓存也过滤一次广告（历史数据可能含垃圾）
      const cleaned = articles.filter((a) => !isSpamResult(a));
      return {
        articles: cleaned,
        cached: true,
        filtered_spam: articles.length - cleaned.length,
      };
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
  let spamBlocked = 0;

  try {
    // 中文赛道：百度优先，Bing 中文站兜底；多查询词拉满候选
    for (const q of queries.slice(0, SEARCH_QUERY_LIMIT)) {
      console.log(`[Search] 查询(中文优先): ${q}`);
      let batch = [];
      try {
        batch = await searchBaidu(page, q, SEARCH_PER_ENGINE);
        if (batch.length) engine = 'baidu';
      } catch (err) {
        console.warn('[Search] 百度失败:', err.message);
        batch = [];
      }
      // 结果不够时用 Bing 补量
      if (batch.length < Math.ceil(SEARCH_PER_ENGINE * 0.5)) {
        try {
          const more = await searchBing(page, q, SEARCH_PER_ENGINE);
          if (more.length && engine !== 'baidu') engine = 'bing';
          batch = batch.concat(more);
        } catch (err) {
          console.warn('[Search] Bing 失败:', err.message);
        }
      } else {
        // 即使百度够量，也轻量补一轮 Bing 增加多样性
        try {
          const more = await searchBing(page, q, Math.min(8, SEARCH_PER_ENGINE));
          batch = batch.concat(more);
        } catch { /* optional */ }
      }

      for (const item of batch) {
        if (!item.url || seenUrls.has(item.url)) continue;
        if (isBadUrl(item.url)) continue;
        if (!isChineseResult(item)) continue;
        const spam = detectSpam(item);
        if (spam.spam) {
          spamBlocked += 1;
          console.log(`[Search] 屏蔽广告/引流: ${item.title.slice(0, 40)} (${spam.reason})`);
          continue;
        }
        seenUrls.add(item.url);
        raw.push(item);
      }
      if (raw.length >= SEARCH_RAW_CAP) break;
    }

    const filtered = rankChineseResults(raw).slice(0, SEARCH_RESULT_LIMIT);
    console.log(
      `[Search] 候选 ${raw.length} → 入库 ${filtered.length}，屏蔽广告/引流 ${spamBlocked}`
    );

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
        filtered_spam: spamBlocked,
        warning: '搜索无结果（或全被广告过滤），已用话题占位素材',
      };
    }

    const extractCount = Math.min(SEARCH_EXTRACT_COUNT, filtered.length);
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
        // 正文层再过一次广告过滤（摘要干净但正文是软广）
        if (body && isSpamResult({ title: item.title, snippet: body.slice(0, 1500), url: item.url })) {
          spamBlocked += 1;
          console.log(`[Search] 正文判定广告/引流，丢弃: ${item.title.slice(0, 40)}`);
          continue;
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

    return {
      articles,
      cached: false,
      search_engine: engine,
      queries,
      filtered_spam: spamBlocked,
      total_candidates: raw.length,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function listArticlesByTopic(topicId) {
  const rows = db.prepare(`
    SELECT * FROM source_articles WHERE topic_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(topicId, SEARCH_LIST_LIMIT);
  // 列表出口再挡一层广告（含历史缓存）
  return rows.filter((a) => !isSpamResult(a));
}

function getArticleById(id) {
  return db.prepare('SELECT * FROM source_articles WHERE id = ?').get(id);
}

module.exports = {
  searchAndSaveArticles,
  listArticlesByTopic,
  getArticleById,
  detectSpam,
  isSpamResult,
};
