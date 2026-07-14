/**
 * 账号登录服务 - 各平台扫码登录流程
 *
 * 职责：
 * - 启动浏览器，进入对应平台登录页
 * - 打开可见窗口供用户扫码
 * - 轮询登录状态，检测登录成功
 * - 提取账号信息（昵称、头像）
 * - 保存会话到 sessions/${platform}_default.json
 */
const browserService = require('./browser-service');
const db = require('../models/db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const SESSION_DIR = path.join(__dirname, '..', '..', 'sessions');

/**
 * 各平台登录配置
 */
/**
 * 平台页常有长连接/轮询，networkidle 容易永远等不到。
 * 统一用 domcontentloaded + 更长超时，再靠后续选择器判断是否登录成功。
 */
const GOTO_OPTS = { waitUntil: 'domcontentloaded', timeout: 60000 };

const LOGIN_CONFIG = {
  xiaohongshu: {
    name: '小红书',
    url: 'https://www.xiaohongshu.com',
    // 登录成功后页面会跳走或出现用户头像
    successSelector: '.user-avatar, .avatar, [class*="user-info"], [class*="avatar"]',
    isLoggedIn: async (page) => {
      const url = page.url();
      if (url.includes('login') || url.includes('passport')) return false;
      const el = await page.$('.user-avatar, .avatar, [class*="user-info"]');
      return !!el;
    },
    // 昵称提取（从 localStorage 或页面元素）
    nicknameExtract: async (page) => {
      try {
        // 优先从创作者中心获取
        await page.goto('https://creator.xiaohongshu.com', GOTO_OPTS);
        await browserService.humanDelay(2000, 3000);
        const nickname = await page.$eval('.user-info .nickname, .avatar-container [class*="name"]', el => el.textContent?.trim())
          .catch(() => null);
        const avatar = await page.$eval('.user-info .avatar, .avatar-container img', el => el.src)
          .catch(() => null);
        return { nickname, avatar };
      } catch {
        return { nickname: null, avatar: null };
      }
    },
  },
  wechat: {
    name: '公众号',
    url: 'https://mp.weixin.qq.com/',
    successSelector: '#headerBar, .weui-desktop-account__nickname, [class*="account_nickname"], .weui-desktop-account',
    // 扫码成功后会从登录页跳到后台（token 等参数出现在 URL）
    isLoggedIn: async (page) => {
      const url = page.url();
      if (url.includes('token=') || /mp\.weixin\.qq\.com\/cgi-bin\//.test(url)) {
        return true;
      }
      const el = await page.$('#headerBar, .weui-desktop-account__nickname, .weui-desktop-account, [class*="account_nickname"]');
      return !!el;
    },
    nicknameExtract: async (page) => {
      try {
        await browserService.humanDelay(2000, 3000);
        const nickname = await page.$eval(
          '#headerBar .account_nickname, .weui-desktop-account__nickname, .weui-desktop-account__info .weui-desktop-account__nickname',
          el => el.textContent?.trim()
        ).catch(() => null);
        const avatar = await page.$eval(
          '#headerBar .account__avatar img, .weui-desktop-account__avatar img, .weui-desktop-account__info img',
          el => el.src
        ).catch(() => null);
        return { nickname, avatar };
      } catch {
        return { nickname: null, avatar: null };
      }
    },
  },
  toutiao: {
    name: '头条号',
    url: 'https://mp.toutiao.com/',
    successSelector: '.user-info, .user-avatar, [class*="userName"]',
    isLoggedIn: async (page) => {
      const url = page.url();
      if (url.includes('login') || url.includes('auth')) return false;
      if (url.includes('mp.toutiao.com') && !url.includes('login')) {
        const el = await page.$('.user-info, .user-avatar, [class*="userName"]');
        if (el) return true;
        // 创作者后台首页也可能没有这些 class，用 cookie 粗判
        const cookies = await page.context().cookies();
        return cookies.some(c => /session|sid|uid|auth/i.test(c.name) && c.value);
      }
      return false;
    },
    nicknameExtract: async (page) => {
      try {
        await browserService.humanDelay(2000, 3000);
        const nickname = await page.$eval('.user-info .name, [class*="userName"]', el => el.textContent?.trim())
          .catch(() => null);
        const avatar = await page.$eval('.user-info .avatar img, .user-avatar img', el => el.src)
          .catch(() => null);
        return { nickname, avatar };
      } catch {
        return { nickname: null, avatar: null };
      }
    },
  },
};

/**
 * 执行账号扫码登录
 * @param {'xiaohongshu'|'wechat'|'toutiao'} platform
 * @returns {Promise<{ok: boolean, account: Object, error?: string}>}
 */
async function login(platform) {
  const config = LOGIN_CONFIG[platform];
  if (!config) {
    return { ok: false, error: `不支持的平台: ${platform}` };
  }

  console.log(`\n🔐 开始 ${config.name} 扫码登录...`);
  console.log(`   👉 浏览器窗口已打开，请使用 ${config.name} App 扫码登录`);
  console.log(`   ⏳ 等待扫码中（最长等待 120 秒）...`);

  const sessionName = `${platform}_default`;
  let context;
  let page;

  try {
    // 可见模式启动（用户需要亲自扫码）
    context = await browserService.createContext(sessionName, { headless: false });
    page = await context.newPage();

    // 打开登录页（勿用 networkidle：公众号/头条后台常有长连接导致超时）
    await page.goto(config.url, GOTO_OPTS);
    await browserService.humanDelay(2000, 4000);

    // 等待登录成功（选择器 + 平台自定义 isLoggedIn）
    const loggedIn = await waitForLogin(page, config, 120000);
    if (!loggedIn) {
      await page.close();
      await context.close();
      return { ok: false, error: `${config.name} 扫码登录超时（120秒内未完成）` };
    }

    await browserService.humanDelay(2000, 3000);

    // 提取账号信息
    const { nickname, avatar } = await config.nicknameExtract(page);

    // 保存会话
    await browserService.saveSession(context);

    // 写入/更新数据库
    const existing = db.prepare('SELECT * FROM accounts WHERE platform = ?').get(platform);
    const id = existing ? existing.id : uuidv4();
    const sessionPath = path.join(SESSION_DIR, `${sessionName}.json`);

    if (existing) {
      db.prepare(`
        UPDATE accounts SET
          nickname = COALESCE(?, nickname),
          avatar = COALESCE(?, avatar),
          status = 'active',
          session_path = ?,
          account_info = ?,
          expired_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nickname, avatar, sessionPath, null, id);
    } else {
      db.prepare(`
        INSERT INTO accounts (id, platform, nickname, avatar, status, session_path)
        VALUES (?, ?, ?, ?, 'active', ?)
      `).run(id, platform, nickname || `${config.name}账号`, avatar || null, sessionPath);
    }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    console.log(`✅ ${config.name} 账号绑定成功: ${account.nickname}`);

    return { ok: true, account };
  } catch (err) {
    console.error(`❌ ${config.name} 登录失败:`, err.message);
    return { ok: false, error: `登录失败: ${err.message}` };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * 轮询等待登录成功
 * @param {import('playwright').Page} page
 * @param {object} config - LOGIN_CONFIG 项
 */
async function waitForLogin(page, config, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (typeof config.isLoggedIn === 'function') {
        if (await config.isLoggedIn(page)) return true;
      } else if (config.successSelector) {
        const el = await page.$(config.successSelector);
        if (el) return true;
      }
    } catch {
      // 忽略中间态（导航中、DOM 重建）
    }
    await browserService.humanDelay(1000, 2000);
  }
  return false;
}

module.exports = {
  login,
};
