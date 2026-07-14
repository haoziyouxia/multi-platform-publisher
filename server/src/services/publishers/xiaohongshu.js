/**
 * 小红书发布器
 *
 * 发布流程：
 *   1. 加载会话 → 进入创作者中心
 *   2. 检查登录态
 *   3. 进入发布页
 *   4. 上传图片（多张）
 *   5. 填写标题 + 正文
 *   6. 点击发布
 *   7. 等待发布结果
 *   8. 保存会话
 *
 * 选择器策略：每个操作点维护多级 fallback selector 列表，
 * 优先匹配第一个存在的元素，提高对页面改版的适应性。
 */
const browserService = require('../browser-service');
const path = require('path');
const fs = require('fs');

const PLATFORM = 'xiaohongshu';
const NAME = '小红书';
const BASE_URL = 'https://www.xiaohongshu.com';
const CREATOR_URL = 'https://creator.xiaohongshu.com';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';

/** 上传目录（用户上传的图片存在这里） */
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', '..', 'uploads');

/** 各操作选择器列表（从精确到模糊，依次尝试） */
const SELECTORS = {
  /** 登录后元素（用于检测登录态） */
  loggedIn: [
    '.user-avatar',
    '.avatar',
    '[class*="user-info"]',
    '[class*="avatar-container"]',
    '.user-menu',
    // 创作者中心
    '.creator-header [class*="avatar"]',
  ],
  /** 图片上传 input */
  fileInput: [
    'input[type="file"]',
    'input[accept="image/*"]',
    'input[name="file"]',
    '.upload-btn input[type="file"]',
  ],
  /** 图片上传成功标记 */
  uploadSuccess: [
    '.upload-success',
    '.image-item',
    '[class*="uploaded"]',
    '[class*="image-list"] img',
    '.media-item img',
  ],
  /** 标题输入框 */
  titleInput: [
    'input[placeholder*="标题"]',
    'input[placeholder*="title"]',
    '#title',
    '[class*="title"] input',
    '[class*="title"] [contenteditable]',
  ],
  /** 正文编辑器 */
  editor: [
    '[contenteditable="true"]',
    '.ql-editor',
    '[class*="editor"] [contenteditable]',
    '[class*="content"] [contenteditable]',
    '.note-editor',
  ],
  /** 发布按钮 */
  publishBtn: [
    'button:has-text("发布")',
    'button:has-text("发布笔记")',
    '[class*="publish"] button',
    '.publish-btn',
    'button[class*="submit"]',
    'button[class*="confirm"]',
  ],
  /** 发布成功标记 */
  publishSuccess: [
    'text=发布成功',
    'text=发布笔记成功',
    '.publish-success',
    '[class*="success"]',
  ],
};

/**
 * 发布内容到小红书
 * @param {Object} content - { id, title, body, images: [{url}], ... }
 * @returns {Object} { postId, url }
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  const context = await browserService.createContext(sessionName);
  const page = await context.newPage();
  const log = (msg) => console.log(`[小红书] ${msg}`);

  try {
    // ======== 1. 进入创作者中心 ========
    log('正在进入创作者中心...');
    await page.goto(CREATOR_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await browserService.humanDelay(2000, 3000);

    // ======== 2. 检查登录态 ========
    log('检查登录态...');
    const isLoggedIn = await detectLoggedIn(page);
    if (!isLoggedIn) {
      // 尝试从主站重定向一次
      log('创作者中心未检测到登录，尝试重定向主站...');
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
      await browserService.humanDelay(2000, 3000);
      
      // 看看是否已登录，不是则抛错
      const retryLoggedIn = await detectLoggedIn(page);
      if (!retryLoggedIn) {
        throw new Error('小红书登录态已过期，请重新授权（账号管理 → 重新绑定）');
      }
      
      // 如果主站登录了，重新回到创作者中心
      log('主站已登录，重新进入创作者中心...');
      await page.goto(CREATOR_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await browserService.humanDelay(2000, 3000);
    }
    log('✅ 登录态正常');

    // ======== 3. 进入发布页 ========
    log('正在进入发布页...');
    await page.goto(PUBLISH_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await browserService.humanDelay(2000, 4000);

    // ======== 4. 上传图片 ========
    if (!content.images || content.images.length === 0) {
      throw new Error('小红书笔记至少需要 1 张图片');
    }
    if (content.images.length > 18) {
      throw new Error('小红书笔记最多支持 18 张图片');
    }

    log(`正在上传 ${content.images.length} 张图片...`);
    await uploadImages(page, content.images, log);

    // ======== 5. 填写标题 ========
    log('正在填写标题...');
    const titleSelector = await findFirstSelector(page, SELECTORS.titleInput);
    if (!titleSelector) {
      throw new Error('找不到标题输入框');
    }
    await page.click(titleSelector);
    await browserService.humanDelay(500, 1000);
    await page.fill(titleSelector, content.title);
    log(`✅ 标题已填写: "${content.title.slice(0, 30)}..."`);

    // ======== 6. 填写正文 ========
    if (content.body) {
      log('正在填写正文...');
      const editorSelector = await findFirstSelector(page, SELECTORS.editor);
      if (!editorSelector) {
        log('⚠️ 找不到正文编辑器，跳过正文填写');
      } else {
        await page.click(editorSelector);
        await browserService.humanDelay(300, 600);
        
        // 清除默认占位内容
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.innerHTML = '';
        }, editorSelector);
        
        await browserService.humanDelay(300, 500);
        
        // 分段输入模拟真人
        const paragraphs = content.body.split('\n').filter(p => p.trim());
        for (const para of paragraphs) {
          await page.type(editorSelector, para, { delay: 20 + Math.random() * 40 });
          await page.keyboard.press('Enter');
          await browserService.humanDelay(200, 500);
        }
        log(`✅ 正文已填写 (${content.body.length} 字符)`);
      }
    }

    await browserService.humanDelay(1000, 2000);

    // ======== 7. 点击发布 ========
    log('正在点击发布按钮...');
    const publishBtnSelector = await findFirstSelector(page, SELECTORS.publishBtn);
    if (!publishBtnSelector) {
      throw new Error('找不到发布按钮');
    }
    log(`找到发布按钮: ${publishBtnSelector}`);
    await page.click(publishBtnSelector);

    // 发布后可能弹确认对话框
    await browserService.humanDelay(1000, 2000);
    
    // 尝试点击二次确认按钮
    try {
      const confirmBtn = await page.waitForSelector('button:has-text("确认发布"), .confirm-btn, button:has-text("确定")', { timeout: 5000 });
      if (confirmBtn) {
        log('检测到发布确认弹窗，点击确认...');
        await confirmBtn.click();
      }
    } catch {
      // 没有确认弹窗，继续
    }

    // ======== 8. 等待发布结果 ========
    log('等待发布结果...');
    const publishResult = await waitForPublishResult(page, log);

    // ======== 9. 保存会话 ========
    await browserService.saveSession(context);

    // ======== 10. 提取笔记信息 ========
    const currentUrl = page.url();
    const postId = publishResult.postId || currentUrl.match(/note\/(\w+)/)?.[1] || `xhs_${Date.now()}`;
    
    log(`🎉 发布成功! 笔记ID: ${postId}`);
    
    return { postId, url: currentUrl };

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 上传图片（多张）
 */
async function uploadImages(page, images, log) {
  const fileInputSelector = await findFirstSelector(page, SELECTORS.fileInput);
  if (!fileInputSelector) {
    throw new Error('找不到图片上传按钮（input[type="file"]）');
  }

  // 将 URL 路径转为磁盘绝对路径
  const filePaths = images.map(img => {
    const url = img.url || img;
    // 移除 /uploads/ 前缀，拼上上传目录
    const filename = path.basename(url);
    return path.join(UPLOAD_DIR, filename);
  });

  // 检查文件是否存在
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      log(`⚠️ 图片文件不存在: ${fp}`);
    } else {
      log(`📷 准备上传: ${fp}`);
    }
  }

  // 对于多图，可能需要逐个上传
  const fileInput = await page.$(fileInputSelector);
  if (!fileInput) throw new Error('图片上传 input 元素不可交互');
  
  // 先设置第一张（或一次性设置所有）
  await fileInput.setInputFiles(filePaths);
  log(`已选择 ${filePaths.length} 张图片`);

  // 等待图片上传完成（上传进度条消失 + 缩略图出现）
  const uploadTimeout = 60000; // 60秒上传等待
  let uploadOk = false;

  try {
    await page.waitForFunction(
      (expectedCount) => {
        // 检测图片缩略图或已上传指示的数量达标
        const items = document.querySelectorAll(
          '.upload-success, .image-item img, [class*="uploaded"], [class*="image-list"] img, .media-item img'
        );
        return items.length >= expectedCount;
      },
      images.length,
      { timeout: uploadTimeout }
    );
    uploadOk = true;
  } catch {
    // 如果精确数量检测超时，回退检测是否有至少一个缩略图
    try {
      await page.waitForSelector(SELECTORS.uploadSuccess.join(','), { timeout: 10000 });
      uploadOk = true;
    } catch {
      log('⚠️ 图片上传状态检测超时，但可能已上传成功');
      uploadOk = false;
    }
  }

  if (uploadOk) {
    log(`✅ 图片上传完成 (${images.length} 张)`);
  } else {
    log('⚠️ 图片上传状态不确定，继续后续流程');
  }

  await browserService.humanDelay(2000, 3000);
}

/**
 * 检测登录态
 */
async function detectLoggedIn(page) {
  for (const sel of SELECTORS.loggedIn) {
    try {
      const el = await page.$(sel);
      if (el) return true;
    } catch { /* 忽略 */ }
  }
  
  // 补充检测：有 localStorage token 或 cookie
  try {
    const hasToken = await page.evaluate(() => {
      // 检查 localStorage 中常见的登录标识
      const keys = ['token', 'access_token', 'user_info', 'logined', 'session'];
      return keys.some(k => localStorage.getItem(k) !== null);
    });
    if (hasToken) return true;
  } catch { /* 忽略 */ }

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

/**
 * 等待发布结果
 */
async function waitForPublishResult(page, log) {
  const result = { postId: null };

  // 方式1: 等待"发布成功"文字出现
  try {
    for (const sel of SELECTORS.publishSuccess) {
      const el = await page.waitForSelector(sel, { timeout: 60000 }).catch(() => null);
      if (el) {
        log('检测到发布成功提示');
        return result;
      }
    }
  } catch {
    // 继续尝试其他方式
  }

  // 方式2: URL 跳转到笔记详情页
  try {
    await page.waitForFunction(
      () => window.location.href.includes('/explore/') || window.location.href.includes('/note/'),
      { timeout: 60000 }
    );
    log('检测到页面跳转至笔记详情');
    const match = page.url().match(/note\/(\w+)/);
    if (match) result.postId = match[1];
    return result;
  } catch {
    // 超时了，不一定是失败
  }

  // 方式3: 检测发布失败提示
  try {
    const errorText = await page.$eval('text=发布失败, .error-message, .toast-error', el => el.textContent).catch(() => null);
    if (errorText) {
      throw new Error(`发布失败: ${errorText}`);
    }
  } catch (e) {
    throw e;
  }

  log('⚠️ 未检测到明确的发布结果，假定发布成功');
  return result;
}

/**
 * 检查登录状态（对外暴露，供 publish-service 或定时任务使用）
 */
async function checkLoginStatus(page) {
  return detectLoggedIn(page);
}

module.exports = {
  name: NAME,
  platform: PLATFORM,
  publish,
  checkLoginStatus,
};
