/**
 * 今日头条发布器
 * 参考: https://github.com/mf-yang/toutiao-ops
 */
const browserService = require('../browser-service');

const PLATFORM = 'toutiao';
const NAME = '今日头条';
const LOGIN_URL = 'https://mp.toutiao.com';
const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';

/**
 * 发布内容到今日头条
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  const context = await browserService.createContext(sessionName);
  const page = await context.newPage();

  try {
    // 1. 检查登录态
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await browserService.humanDelay(2000, 3000);

    const currentUrl = page.url();
    if (currentUrl.includes('login') || !await checkLoginStatus(page)) {
      throw new Error('头条号登录态已过期，请重新授权');
    }

    // 2. 进入文章发布页面
    await page.goto(PUBLISH_URL, { waitUntil: 'networkidle' });
    await browserService.humanDelay(3000, 5000);

    // 3. 填写标题
    const titleInput = await page.waitForSelector(
      'input[placeholder*="标题"], textarea[placeholder*="标题"], .article-title input',
      { timeout: 15000 }
    );
    await titleInput.click();
    await titleInput.fill('');
    await page.keyboard.type(content.title, { delay: 30 });

    // 4. 填写正文
    const editor = await page.waitForSelector(
      '.ql-editor, [contenteditable="true"], .ProseMirror',
      { timeout: 10000 }
    );
    await editor.click();
    await page.keyboard.type(content.body || '', { delay: 30 });

    await browserService.humanDelay(1000, 2000);

    // 5. 上传图片（如果有）- 头条会自动从正文首图抓取封面
    if (content.images && content.images.length > 0) {
      // 在正文中插入图片
      const imgBtn = await page.$('button:has-text("图片"), .toolbar-item[data-type="image"]');
      if (imgBtn) {
        await imgBtn.click();
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        const imagePaths = content.images.map(img => img.url.replace('/uploads/', './uploads/'));
        await fileInput.setInputFiles(imagePaths);
        await browserService.humanDelay(3000, 5000);
      }
    }

    // 6. 点击发布
    const publishBtn = await page.waitForSelector(
      'button:has-text("发布"), button:has-text("发表")',
      { timeout: 10000 }
    );
    await publishBtn.click();

    // 7. 等待发布结果
    await page.waitForSelector('text=发布成功, text=已发布', { timeout: 30000 })
      .catch(() => {
        throw new Error('头条号发布超时，请检查创作者平台');
      });

    // 8. 保存会话
    await browserService.saveSession(context);

    const resultUrl = page.url();
    const postId = resultUrl.match(/\/(\w+)$/)?.[1] || `tt_${Date.now()}`;

    return { postId, url: resultUrl };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * 检查头条号登录状态
 */
async function checkLoginStatus(page) {
  try {
    // 登录后有用户信息/管理后台的特征元素
    const element = await page.$('.user-info, .header-avatar, [class*="account-info"]');
    return !!element;
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
