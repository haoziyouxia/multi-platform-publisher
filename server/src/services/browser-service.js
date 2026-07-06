/**
 * 浏览器服务 - 管理 Playwright 浏览器实例
 */
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

chromium.use(StealthPlugin());

let browserInstance = null;

const SESSION_DIR = path.join(__dirname, '..', '..', 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

/**
 * 获取或创建浏览器实例
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    console.log('🌐 浏览器实例已启动');
  }
  return browserInstance;
}

/**
 * 创建或恢复浏览器上下文（带会话）
 */
async function createContext(sessionName) {
  const browser = await getBrowser();
  const sessionPath = path.join(SESSION_DIR, `${sessionName}.json`);

  // 如果有保存的会话，加载它
  const contextOptions = {
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  };

  if (fs.existsSync(sessionPath)) {
    contextOptions.storageState = sessionPath;
    console.log(`📂 恢复会话: ${sessionName}`);
  }

  const context = await browser.newContext(contextOptions);
  
  // 保存会话的钩子
  context._sessionName = sessionName;
  context._sessionPath = sessionPath;

  return context;
}

/**
 * 保存浏览器会话
 */
async function saveSession(context) {
  if (context._sessionPath) {
    await context.storageState({ path: context._sessionPath });
    console.log(`💾 会话已保存: ${context._sessionName}`);
  }
}

/**
 * 检查会话是否存在
 */
function hasSession(sessionName) {
  return fs.existsSync(path.join(SESSION_DIR, `${sessionName}.json`));
}

/**
 * 删除会话
 */
function deleteSession(sessionName) {
  const sessionPath = path.join(SESSION_DIR, `${sessionName}.json`);
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
    console.log(`🗑️ 会话已删除: ${sessionName}`);
  }
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    console.log('🌐 浏览器实例已关闭');
  }
}

/**
 * 等待并模拟真人操作
 */
async function humanDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 模拟真人输入
 */
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
  }
}

module.exports = {
  getBrowser,
  createContext,
  saveSession,
  hasSession,
  deleteSession,
  closeBrowser,
  humanDelay,
  humanType,
};
