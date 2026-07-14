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
const LOGIN_CONFIG = {
  xiaohongshu: {
    name: '小红书',
    url: 'https://www.xiaohongshu.com',
    // 登录成功后页面会跳走或出现用户头像
    successSelector: '.user-avatar, .avatar, [class*="user-info"]',
    // 昵称提取（从 localStorage 或页面元素）
    nicknameExtract: async (page) => {
      try {
        // 优先从创作者中心获取
        await page.goto('https://creator.xiaohongshu.com', { waitUntil: 'networkidle', timeout: 15000 });
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
    successSelector: '#headerBar, .weui-desktop-account__nickname, [class*="account_nickname"]',
    nicknameExtract: async (page) => {
      try {
        await browserService.humanDelay(2000, 3000);
        const nickname = await page.$eval('#headerBar .account_nickname, .weui-desktop-account__nickname', el => el.textContent?.trim())
          .catch(() => null);
        const avatar = await page.$eval('#headerBar .account__avatar img, .weui-desktop-account__avatar img', el => el.src)
          .catch(() => null);
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

    // 打开登录页
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 30000 });
    await browserService.humanDelay(2000, 4000);

    // 等待登录成功（轮询 successSelector）
    const loggedIn = await waitForLogin(page, config.successSelector, 120000);
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
 * 轮询等待登录成功（检测页面上出现登录后元素）
 */
async function waitForLogin(page, selector, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const el = await page.$(selector);
      if (el) return true;

      // 也检查 URL 是否发生了有意义的跳转（各平台登录后 URL 可能变化）
      const currentUrl = page.url();
      if (currentUrl.includes('login') === false && currentUrl !== 'about:blank') {
        // URL 已不再是登录页，可能已登录成功
        const el2 = await page.$(selector);
        if (el2) return true;
      }
    } catch {
      // 忽略中间态
    }
    await browserService.humanDelay(1000, 2000);
  }
  return false;
}

module.exports = {
  login,
};
