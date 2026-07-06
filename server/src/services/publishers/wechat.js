/**
 * 微信公众号发布器
 */
const browserService = require('../browser-service');
const path = require('path');

const PLATFORM = 'wechat';
const NAME = '微信公众号';
const LOGIN_URL = 'https://mp.weixin.qq.com';
const EDITOR_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77';

/**
 * 发布内容到微信公众号
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
    // 如果被重定向到登录页，说明未登录
    if (currentUrl.includes('login') || !await checkLoginStatus(page)) {
      throw new Error('公众号登录态已过期，请重新授权');
    }

    // 2. 进入图文编辑器
    await page.goto(EDITOR_URL, { waitUntil: 'networkidle' });
    await browserService.humanDelay(3000, 5000);

    // 3. 填写标题
    const titleInput = await page.waitForSelector('#title, input[placeholder*="标题"]', { timeout: 15000 });
    await titleInput.click();
    await titleInput.fill('');
    await page.keyboard.type(content.title, { delay: 30 });

    // 4. 填写正文（公众号编辑器是富文本）
    const editor = await page.waitForSelector('#ueditor_0, .edui-body-container, [contenteditable="true"]', { timeout: 10000 });
    await editor.click();
    await page.keyboard.type(content.body || '', { delay: 30 });

    await browserService.humanDelay(1000, 2000);

    // 5. 上传图片（如果有）
    if (content.images && content.images.length > 0) {
      const imgBtn = await page.$('a:has-text("图片"), .js_upload_img');
      if (imgBtn) {
        await imgBtn.click();
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 });
        const imagePaths = content.images.map(img => 
          path.resolve(__dirname, '..', '..', '..', '..', 'uploads', img.filename)
        );
        await fileInput.setInputFiles(imagePaths);
        await browserService.humanDelay(3000, 5000);
      }
    }

    // 6. 保存为草稿
    const saveBtn = await page.waitForSelector('button:has-text("保存"), a:has-text("保存为草稿")', { timeout: 10000 });
    await saveBtn.click();
    await browserService.humanDelay(2000, 3000);

    // 7. 群发/发布
    const publishBtn = await page.waitForSelector('button:has-text("群发"), a:has-text("发表")', { timeout: 10000 });
    await publishBtn.click();

    // 8. 确认发布
    const confirmBtn = await page.waitForSelector('button:has-text("确定"), .weui-desktop-btn_primary', { timeout: 5000 });
    await confirmBtn.click();

    // 9. 等待发布结果
    await page.waitForSelector('text=已发送, text=发布成功', { timeout: 60000 })
      .catch(() => {
        throw new Error('公众号发布超时，请检查公众号后台');
      });

    // 10. 保存会话
    await browserService.saveSession(context);

    return { postId: `wechat_${Date.now()}`, url: page.url() };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * 检查公众号登录状态
 */
async function checkLoginStatus(page) {
  try {
    // 登录后页面会有管理后台的特征元素
    const element = await page.$('.account_box, .main_bd, .weui-desktop-account');
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
