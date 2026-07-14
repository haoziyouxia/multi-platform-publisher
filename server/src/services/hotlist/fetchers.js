/**
 * 多榜热搜拉取（Playwright）
 * 单源失败不抛到外层，返回 { ok, items, error }
 */
const browserService = require('../browser-service');

const TOP_N = 20;

async function withPage(fn) {
  const context = await browserService.createContext(`hotlist_${Date.now()}`, { headless: true });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 百度热搜 https://top.baidu.com/board?tab=realtime
 */
async function fetchBaiduHot() {
  try {
    const items = await withPage(async (page) => {
      await page.goto('https://top.baidu.com/board?tab=realtime', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await browserService.humanDelay(2500, 3500);
      return page.evaluate((n) => {
        const rows = [];
        // 新版结构
        const titles = document.querySelectorAll('.c-single-text-ellipsis, .title_dIF3B, .hot-title, a.item-title-content');
        if (titles.length > 0) {
          titles.forEach((el, i) => {
            if (i >= n) return;
            const t = (el.textContent || '').trim();
            if (t) rows.push({ title: t, rank: i + 1 });
          });
          return rows;
        }
        // 兜底：热榜条目链接
        document.querySelectorAll('a[href*="keyword"], .theme-hot .list-item').forEach((el) => {
          if (rows.length >= n) return;
          const t = (el.textContent || '').trim().replace(/^\d+/, '').trim();
          if (t && t.length < 40) rows.push({ title: t, rank: rows.length + 1 });
        });
        return rows;
      }, TOP_N);
    });
    return { ok: items.length > 0, items, error: items.length ? null : '未解析到百度热搜条目' };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

/**
 * 微博热搜（公开接口优先，失败再爬页面）
 */
async function fetchWeiboHot() {
  try {
    // 公开 JSON（无需登录，偶发失败）
    const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://weibo.com/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      const realtime = data?.data?.realtime || [];
      const items = realtime.slice(0, TOP_N).map((it, i) => ({
        title: it.word || it.note || it.word_scheme || '',
        rank: i + 1,
      })).filter((x) => x.title);
      if (items.length) return { ok: true, items, error: null };
    }
  } catch {
    // fall through
  }

  try {
    const items = await withPage(async (page) => {
      await page.goto('https://s.weibo.com/top/summary?cate=realtimehot', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await browserService.humanDelay(2500, 3500);
      return page.evaluate((n) => {
        const rows = [];
        document.querySelectorAll('table tbody tr, #pl_top_realtimehot tbody tr').forEach((tr) => {
          if (rows.length >= n) return;
          const a = tr.querySelector('td.td-02 a, a[href*="weibo?q="]');
          const t = (a?.textContent || '').trim();
          if (t && !t.includes('免责声明')) rows.push({ title: t, rank: rows.length + 1 });
        });
        return rows;
      }, TOP_N);
    });
    return { ok: items.length > 0, items, error: items.length ? null : '未解析到微博热搜条目' };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

/**
 * 知乎热榜
 */
async function fetchZhihuHot() {
  try {
    const items = await withPage(async (page) => {
      await page.goto('https://www.zhihu.com/billboard', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await browserService.humanDelay(3000, 4000);
      return page.evaluate((n) => {
        const rows = [];
        // 新版热榜
        document.querySelectorAll('.HotList-item, [class*="HotItem"], .HotList-list .HotItem').forEach((el) => {
          if (rows.length >= n) return;
          const tEl = el.querySelector('.HotItem-title, h2, a');
          const t = (tEl?.textContent || '').trim();
          if (t) rows.push({ title: t, rank: rows.length + 1 });
        });
        if (rows.length) return rows;
        document.querySelectorAll('a[data-za-detail-view-element_name="Title"]').forEach((a) => {
          if (rows.length >= n) return;
          const t = (a.textContent || '').trim();
          if (t) rows.push({ title: t, rank: rows.length + 1 });
        });
        return rows;
      }, TOP_N);
    });
    return { ok: items.length > 0, items, error: items.length ? null : '未解析到知乎热榜条目' };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

/**
 * 并行拉取三榜
 */
async function fetchAllHotlists() {
  const sources = [
    { source: 'baidu_hot', name: '百度热搜', weight: 1.0, fetch: fetchBaiduHot },
    { source: 'weibo_hot', name: '微博热搜', weight: 0.9, fetch: fetchWeiboHot },
    { source: 'zhihu_hot', name: '知乎热榜', weight: 1.1, fetch: fetchZhihuHot },
  ];

  const results = await Promise.all(
    sources.map(async (s) => {
      console.log(`[Hotlist] 拉取 ${s.name}...`);
      const r = await s.fetch();
      console.log(`[Hotlist] ${s.name}: ${r.ok ? `${r.items.length} 条` : `失败 ${r.error}`}`);
      return {
        source: s.source,
        name: s.name,
        weight: s.weight,
        ok: r.ok,
        items: r.items,
        error: r.error,
      };
    })
  );

  return results;
}

module.exports = {
  fetchBaiduHot,
  fetchWeiboHot,
  fetchZhihuHot,
  fetchAllHotlists,
  TOP_N,
};
