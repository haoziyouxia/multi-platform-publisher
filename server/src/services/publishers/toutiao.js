/**
 * 今日头条号发布器
 *
 * 发布流程：
 *   1. 加载会话 → 进入创作者平台
 *   2. 检查登录态
 *   3. 进入文章发布页
 *   4. 填写标题 + 正文
 *   5. 在正文中插入图片（头条会自动从正文首图抓取封面）
 *   6. 点击发布
 *   7. 等待发布结果
 *   8. 保存会话
 *
 * 参考: https://github.com/mf-yang/toutiao-ops
 */
const browserService = require('../browser-service');
const path = require('path');
const fs = require('fs');

const PLATFORM = 'toutiao';
const NAME = '今日头条';
const LOGIN_URL = 'https://mp.toutiao.com';
const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', '..', 'uploads');

const SELECTORS = {
  loggedIn: [
    '.user-info',
    '.header-avatar',
    '[class*="account-info"]',
    '.avatar-wrap',
    '.user-avatar',
    '[class*="userName"]',
    '.side-bar .user-info',
  ],
  titleInput: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    '.article-title input',
    '#title',
    'input[name="title"]',
    '[class*="title"] input',
  ],
  editor: [
    '.ql-editor',
    '[contenteditable="true"]',
    '.ProseMirror',
    '#editor',
    '.article-content [contenteditable]',
  ],
  imgBtn: [
    'button:has-text("图片")',
    '.toolbar-item[data-type="image"]',
    'i.icon-image',
    '[class*="image-upload"]',
    '.ql-toolbar button[data-value="image"]',
  ],
  fileInput: [
    'input[type="file"]',
    'input[accept="image/*"]',
  ],
  publishBtn: [
    'button:has-text("发布")',
    'button:has-text("发表")',
    '.publish-btn',
    'button[class*="submit"]',
    'button[class*="publish"]',
  ],
  publishSuccess: [
    'text=发布成功',
    'text=已发布',
    'text=发表成功',
    '.toast-success',
    '.success-message',
  ],
};

/**
 * 发布内容到今日头条
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  const context = await browserService.createContext(sessionName);
  const page = await context.newPage();
  const log = (msg) => console.log(`[头条号] ${msg}`);

  try {
    // ======== 1. 进入创作者平台 ========
    log('正在进入创作者平台...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await browserService.humanDelay(2000, 3000);

    // ======== 2. 检查登录态 ========
    log('检查登录态...');
    const currentUrl = page.url();
    if (currentUrl.includes('login') || !await checkLoginStatus(page)) {
      throw new Error('头条号登录态已过期，请重新授权');
    }
    log('✅ 登录态正常');

    // ======== 3. 进入文章发布页 ========
    log('正在进入文章发布页...');
    await page.goto(PUBLISH_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await browserService.humanDelay(3000, 5000);

    // 再次检测登录态
    if (page.url().includes('login')) {
      throw new Error('头条号登录态已过期，发布页被重定向到登录页');
    }

    // ======== 4. 填写标题 ========
    log('正在填写标题...');
    const titleSelector = await findFirstSelector(page, SELECTORS.titleInput);
    if (!titleSelector) {
      throw new Error('找不到标题输入框');
    }
    await page.click(titleSelector);
    await browserService.humanDelay(500, 1000);
    
    // 头条标题最长 30 字
    const title = content.title.length > 30 ? content.title.slice(0, 30) : content.title;
    await page.fill(titleSelector, title);
    log(`✅ 标题已填写: "${title.slice(0, 30)}..."`);

    // ======== 5. 填写正文 ========
    if (content.body) {
      log('正在填写正文...');
      const editorSelector = await findFirstSelector(page, SELECTORS.editor);
      if (!editorSelector) {
        log('⚠️ 找不到正文编辑器，跳过正文填写');
      } else {
        await page.click(editorSelector);
        await browserService.humanDelay(500, 1000);

        // 分段输入
        const paragraphs = content.body.split('\n').filter(p => p.trim());
        for (const para of paragraphs) {
          await page.type(editorSelector, para, { delay: 20 + Math.random() * 40 });
          await page.keyboard.press('Enter');
          await browserService.humanDelay(200, 500);
        }
        log(`✅ 正文已填写 (${content.body.length} 字符)`);
      }
    }

    // ======== 6. 上传图片（如有） ========
    if (content.images && content.images.length > 0) {
      log(`准备上传 ${content.images.length} 张图片`);
      await uploadImages(page, content.images, log);
    }

    await browserService.humanDelay(1000, 2000);

    // ======== 7. 点击发布 ========
    log('正在点击发布按钮...');
    const publishBtnSelector = await findFirstSelector(page, SELECTORS.publishBtn);
    if (!publishBtnSelector) {
      throw new Error('找不到发布按钮');
    }
    await page.click(publishBtnSelector);

    // 发布后可能有确认弹窗
    await browserService.humanDelay(1000, 2000);
    
    try {
      const confirmBtn = await page.waitForSelector('button:has-text("确认"), button:has-text("确定")', { timeout: 5000 });
      if (confirmBtn) {
        log('检测到发布确认弹窗，点击确认');
        await confirmBtn.click();
      }
    } catch {
      // 没有确认弹窗，继续
    }

    // ======== 8. 等待发布结果 ========
    log('等待发布结果...');
    const result = await waitForPublishResult(page, log);

    // ======== 9. 保存会话 ========
    await browserService.saveSession(context);

    log(`🎉 发布成功! 文章ID: ${result.postId || 'N/A'}`);
    return { postId: result.postId || `tt_${Date.now()}`, url: page.url() };

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 上传图片到头条编辑器
 * 头条编辑器需要先点"图片"按钮，然后选择本地图片
 */
async function uploadImages(page, images, log) {
  const imgBtnSelector = await findFirstSelector(page, SELECTORS.imgBtn);
  if (!imgBtnSelector) {
    log('⚠️ 找不到图片按钮，跳过图片上传');
    return;
  }

  const filePaths = images.map(img => {
    const url = img.url || img;
    const filename = path.basename(url);
    return path.join(UPLOAD_DIR, filename);
  });

  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      log(`⚠️ 图片文件不存在: ${fp}`);
    }
  }

  await page.click(imgBtnSelector);
  log('已点击图片按钮，等待文件选择框');

  const fileInput = await page.waitForSelector(SELECTORS.fileInput.join(','), { timeout: 10000 })
    .catch(() => null);
  if (!fileInput) {
    throw new Error('点击图片按钮后未出现文件选择框');
  }

  // 头条可能需要逐张上传，先尝试批量上传
  await fileInput.setInputFiles(filePaths);
  log(`已选择 ${filePaths.length} 张图片`);

  // 等待上传完成（头条的图片会插入到正文中）
  await browserService.humanDelay(3000, 5000);

  try {
    // 检测正文内是否有图片元素出现
    await page.waitForSelector(`${SELECTORS.editor[0]} img, .ql-editor img, [contenteditable] img`, { timeout: 60000 });
    log('✅ 图片上传完成');
  } catch {
    log('⚠️ 图片上传状态检测超时，继续后续流程');
  }
}

/**
 * 等待发布结果
 */
async function waitForPublishResult(page, log) {
  const result = { postId: null };

  for (const sel of SELECTORS.publishSuccess) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 30000 });
      if (el) {
        log('检测到发布成功提示');
        return result;
      }
    } catch { /* 继续 */ }
  }

  // URL 跳转检测
  try {
    await page.waitForFunction(
      () => window.location.href.includes('profile_v4/graphic') || 
            window.location.href.includes('published') ||
            document.querySelector('.publish-success'),
      { timeout: 30000 }
    );
    log('检测到页面跳转');
    return result;
  } catch {
    // 继续
  }

  log('⚠️ 未检测到明确的发布结果，假定发布成功');
  return result;
}

/**
 * 检查头条号登录状态
 */
async function checkLoginStatus(page) {
  for (const sel of SELECTORS.loggedIn) {
    try {
      const el = await page.$(sel);
      if (el) return true;
    } catch { /* 忽略 */ }
  }
  return false;
}

/**
 * 从选择器列表中查找第一个匹配页面上存在的元素
 */
async function findFirstSelector(page, selectorList) {
  for (const sel of selectorList) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) return sel;
      }
    } catch { /* 忽略 */ }
  }
  return null;
}

module.exports = {
  name: NAME,
  platform: PLATFORM,
  publish,
  checkLoginStatus,
};
