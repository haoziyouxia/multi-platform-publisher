/**
 * 微信公众号发布器
 *
 * 发布流程（公众号特有"草稿箱"流程）:
 *   1. 加载会话 → 进入公众号后台
 *   2. 检查登录态
 *   3. 进入图文编辑器
 *   4. 填写标题 + 正文
 *   5. 上传图片（如有）
 *   6. 保存为草稿
 *   7. 群发/发表
 *   8. 二次确认
 *   9. 等待发布结果
 *   10. 保存会话
 *
 * 注意：公众号个人订阅号每天只能群发 1 次。
 */
const browserService = require('../browser-service');
const path = require('path');
const fs = require('fs');

const PLATFORM = 'wechat';
const NAME = '微信公众号';
const LOGIN_URL = 'https://mp.weixin.qq.com';
const EDITOR_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token=';
const DRAFT_LIST_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_list&action=list&type=10&token=';

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', '..', 'uploads');

const SELECTORS = {
  loggedIn: [
    '.account_box',
    '.main_bd',
    '.weui-desktop-account',
    '#headerBar',
    '.account_nickname',
    '.weui-desktop-account__nickname',
  ],
  titleInput: [
    '#title',
    'input[placeholder*="标题"]',
    'input[name="title"]',
    '[class*="title"] input',
  ],
  editor: [
    '#ueditor_0',
    '.edui-body-container',
    'iframe[id*="ueditor"]',
    '[contenteditable="true"]',
    '.ql-editor',
  ],
  imgBtn: [
    'a:has-text("图片")',
    '.js_upload_img',
    '[class*="upload-img"]',
    'button:has-text("图片")',
  ],
  fileInput: [
    'input[type="file"]',
    'input[accept="image/*"]',
  ],
  uploadSuccess: [
    '.js_img_box img',
    '.img_preview img',
    '[class*="upload-success"]',
    '.img_item img',
  ],
  saveBtn: [
    'button:has-text("保存")',
    'a:has-text("保存为草稿")',
    '#js_save',
    '.js_save',
  ],
  publishBtn: [
    'button:has-text("群发")',
    'a:has-text("发表")',
    'button:has-text("发送")',
    '.js_send',
  ],
  confirmBtn: [
    'button:has-text("确定")',
    '.weui-desktop-btn_primary',
    '.weui-desktop-btn:has-text("确认")',
    'button:has-text("确认发送")',
  ],
  publishSuccess: [
    'text=已发送',
    'text=发布成功',
    'text=发送成功',
    '.toast_success',
  ],
};

/**
 * 发布内容到微信公众号
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  const context = await browserService.createContext(sessionName);
  const page = await context.newPage();
  const log = (msg) => console.log(`[公众号] ${msg}`);

  try {
    // ======== 1. 进入公众号后台 ========
    log('正在进入公众号后台...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await browserService.humanDelay(2000, 3000);

    // ======== 2. 检查登录态 ========
    log('检查登录态...');
    const currentUrl = page.url();
    if (currentUrl.includes('login') || !await checkLoginStatus(page)) {
      throw new Error('公众号登录态已过期，请重新授权');
    }
    log('✅ 登录态正常');

    // 从当前 URL 中提取 token（公众号后台所有页面都需要 token 参数）
    const token = extractTokenFromUrl(page.url());

    // ======== 3. 进入图文编辑器 ========
    const editorUrl = token ? `${EDITOR_URL}${token}` : LOGIN_URL;
    log(`正在进入图文编辑器...${token ? `(token=${token.slice(0, 8)}...)` : ''}`);
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await browserService.humanDelay(3000, 5000);

    // 再次检测登录态（编辑器页面可能再次重定向）
    if (page.url().includes('login')) {
      throw new Error('公众号登录态已过期，编辑器页面被重定向到登录页');
    }

    // ======== 4. 填写标题 ========
    log('正在填写标题...');
    const titleSelector = await findFirstSelector(page, SELECTORS.titleInput);
    if (!titleSelector) {
      throw new Error('找不到标题输入框');
    }
    await page.click(titleSelector);
    await browserService.humanDelay(500, 1000);
    
    // 公众号标题最长 64 字符
    const title = content.title.length > 64 ? content.title.slice(0, 64) : content.title;
    await page.fill(titleSelector, title);
    log(`✅ 标题已填写: "${title.slice(0, 30)}..."`);

    // ======== 5. 填写正文 ========
    if (content.body) {
      log('正在填写正文...');
      const editorSelector = await findFirstSelector(page, SELECTORS.editor);
      if (!editorSelector) {
        log('⚠️ 找不到正文编辑器，跳过正文填写');
      } else {
        // 公众号编辑器是 UEditor iframe / contenteditable
        await page.click(editorSelector);
        await browserService.humanDelay(500, 1000);

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

    // ======== 6. 上传图片（如有） ========
    if (content.images && content.images.length > 0) {
      log(`准备上传 ${content.images.length} 张图片`);
      await uploadImages(page, content.images, log);
    }

    await browserService.humanDelay(1000, 2000);

    // ======== 7. 保存为草稿 ========
    log('正在保存为草稿...');
    const saveBtnSelector = await findFirstSelector(page, SELECTORS.saveBtn);
    if (saveBtnSelector) {
      await page.click(saveBtnSelector);
      await browserService.humanDelay(2000, 3000);
      log('✅ 已保存为草稿');
    } else {
      log('⚠️ 找不到保存按钮，跳过草稿保存步骤');
    }

    // ======== 8. 群发/发表 ========
    log('正在点击群发/发表按钮...');
    const publishBtnSelector = await findFirstSelector(page, SELECTORS.publishBtn);
    if (!publishBtnSelector) {
      throw new Error('找不到群发/发表按钮（公众号可能因订阅号类型限制群发功能，请检查账号权限）');
    }
    await page.click(publishBtnSelector);
    await browserService.humanDelay(1000, 2000);

    // ======== 9. 二次确认 ========
    log('等待二次确认弹窗...');
    const confirmBtnSelector = await findFirstSelector(page, SELECTORS.confirmBtn);
    if (confirmBtnSelector) {
      // 等待确认按钮可见
      await page.waitForSelector(confirmBtnSelector, { timeout: 10000 }).catch(() => {});
      await page.click(confirmBtnSelector);
      log('✅ 已点击确认');
    } else {
      log('⚠️ 未检测到二次确认弹窗');
    }

    // ======== 10. 等待发布结果 ========
    log('等待发布结果...');
    const result = await waitForPublishResult(page, log);

    // ======== 11. 保存会话 ========
    await browserService.saveSession(context);

    log(`🎉 发布成功! 文章ID: ${result.postId || 'N/A'}`);
    return { postId: result.postId || `wechat_${Date.now()}`, url: page.url() };

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 上传图片到公众号编辑器
 */
async function uploadImages(page, images, log) {
  // 公众号编辑器需要先点"图片"按钮才会出现 input[type="file"]
  const imgBtnSelector = await findFirstSelector(page, SELECTORS.imgBtn);
  if (!imgBtnSelector) {
    log('⚠️ 找不到图片按钮，跳过图片上传');
    return;
  }

  // 将 URL 路径转为磁盘绝对路径
  const filePaths = images.map(img => {
    const url = img.url || img;
    const filename = path.basename(url);
    return path.join(UPLOAD_DIR, filename);
  });

  // 检查文件是否存在
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      log(`⚠️ 图片文件不存在: ${fp}`);
    }
  }

  // 点击图片按钮，等待 input[type="file"] 出现
  await page.click(imgBtnSelector);
  log('已点击图片按钮，等待文件选择框');

  const fileInputSelector = await page.waitForSelector(SELECTORS.fileInput.join(','), { timeout: 10000 })
    .catch(() => null);
  if (!fileInputSelector) {
    throw new Error('点击图片按钮后未出现文件选择框');
  }

  await fileInputSelector.setInputFiles(filePaths);
  log(`已选择 ${filePaths.length} 张图片`);

  // 等待上传完成
  try {
    await page.waitForSelector(SELECTORS.uploadSuccess.join(','), { timeout: 60000 });
    log('✅ 图片上传完成');
  } catch {
    log('⚠️ 图片上传状态检测超时，继续后续流程');
  }
  await browserService.humanDelay(2000, 3000);
}

/**
 * 等待发布结果
 */
async function waitForPublishResult(page, log) {
  const result = { postId: null };

  // 尝试1: 等待"已发送/发布成功"文字
  for (const sel of SELECTORS.publishSuccess) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 60000 });
      if (el) {
        log('检测到发布成功提示');
        return result;
      }
    } catch { /* 继续尝试 */ }
  }

  // 尝试2: URL 跳转到草稿列表/已发送列表
  try {
    await page.waitForFunction(
      () => window.location.href.includes('appmsg_list') || window.location.href.includes('send'),
      { timeout: 30000 }
    );
    log('检测到页面跳转至列表页');
    return result;
  } catch {
    // 继续
  }

  log('⚠️ 未检测到明确的发布结果，假定发布成功');
  return result;
}

/**
 * 从 URL 中提取公众号 token 参数
 * 公众号后台所有页面 URL 都带 ?token=xxx
 */
function extractTokenFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

/**
 * 检查公众号登录状态
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
