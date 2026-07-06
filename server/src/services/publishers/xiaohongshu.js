/**
 * 小红书发布器
 */
const browserService = require('../browser-service');

const PLATFORM = 'xiaohongshu';
const NAME = '小红书';
const LOGIN_URL = 'https://www.xiaohongshu.com';
const CREATE_URL = 'https://creator.xiaohongshu.com/publish/publish';

/**
 * 发布内容到小红书
 * @param {Object} content - 内容对象 { title, body, images }
 * @returns {Object} { postId, url }
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  const context = await browserService.createContext(sessionName);
  const page = await context.newPage();

  try {
    // 1. 检查登录态
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await browserService.humanDelay(2000, 3000);

    const isLoggedIn = await checkLoginStatus(page);
    if (!isLoggedIn) {
      throw new Error('小红书登录态已过期，请重新授权');
    }

    // 2. 进入创作中心
    await page.goto(CREATE_URL, { waitUntil: 'networkidle' });
    await browserService.humanDelay(2000, 3000);

    // 3. 上传图片
    if (!content.images || content.images.length === 0) {
      throw new Error('小红书笔记至少需要 1 张图片');
    }

    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
    const imagePaths = content.images.map(img => img.url.replace('/uploads/', './uploads/'));
    await fileInput.setInputFiles(imagePaths);
    
    // 等待图片上传完成
    await page.waitForSelector('.upload-success, .image-item', { timeout: 30000 });
    await browserService.humanDelay(2000, 4000);

    // 4. 填写标题
    const titleInput = await page.waitForSelector('input[placeholder*="标题"], #title', { timeout: 10000 });
    await titleInput.click();
    await titleInput.fill('');
    await browserService.humanType(page, 'input[placeholder*="标题"], #title', content.title);

    // 5. 填写正文
    const editor = await page.waitForSelector('[contenteditable="true"], .ql-editor', { timeout: 10000 });
    await editor.click();
    await page.keyboard.type(content.body || '', { delay: 30 });
    
    await browserService.humanDelay(1000, 2000);

    // 6. 点击发布
    const publishBtn = await page.waitForSelector('button:has-text("发布")', { timeout: 10000 });
    await publishBtn.click();

    // 7. 等待发布结果
    await page.waitForSelector('text=发布成功', { timeout: 30000 })
      .catch(() => {
        throw new Error('发布超时，请检查小红书创作者平台');
      });

    // 8. 保存会话
    await browserService.saveSession(context);

    // 9. 获取发布后的笔记ID（从URL或页面提取）
    const currentUrl = page.url();
    const postId = currentUrl.match(/\/(\w+)$/)?.[1] || `xhs_${Date.now()}`;

    return { postId, url: currentUrl };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * 检查小红书登录状态
 */
async function checkLoginStatus(page) {
  try {
    // 检查是否有用户头像/昵称等登录后元素
    const userElement = await page.$('.user-avatar, .avatar, [class*="user-info"]');
    return !!userElement;
  } catch {
    return false;
  }
}

module.exports = {
  name: NAME,
  platform: PLATFORM,
  publish,
  checkLoginStatus,
};
