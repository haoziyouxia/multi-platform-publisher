/**
 * 微信公众号发布器
 *
 * 发布流程:
 *   1. 加载会话 → 进入公众号后台首页
 *   2. 检查登录态并提取 token
 *   3. 通过 UI / URL 进入「新建图文」编辑器（不要写死 type=77，新版常无效）
 *   4. 填写标题 + 作者 + 正文
 *   5. 设置封面图 + 声明原创
 *   6. 上传正文图片（如有）
 *   7. 保存草稿（MVP 成功标准）
 *   8. 尝试群发/发表（可选）
 *
 * 注意：个人订阅号每天群发次数有限；草稿保存成功即视为本阶段成功。
 */
const browserService = require('../browser-service');
const { generateWechatCover } = require('../cover-generator');
const path = require('path');
const fs = require('fs');

const PLATFORM = 'wechat';
const NAME = '微信公众号';
const LOGIN_URL = 'https://mp.weixin.qq.com';
const HOME_URL = 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN';
// 常见图文新建 URL（type=10 为图文消息；type=77 在新版后台经常打不开标题区）
const EDITOR_URL_TYPE10 = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&isNew=1&lang=zh_CN&token=';
const EDITOR_URL_TYPE77 = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&isNew=1&lang=zh_CN&token=';

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', '..', 'uploads');
const DEBUG_DIR = path.resolve(__dirname, '..', '..', '..', 'debug');

/** 默认作者（公众号作者字段 ≤ 8 字） */
const DEFAULT_AUTHOR = (process.env.WECHAT_AUTHOR || '咸鱼翻炒炸').slice(0, 8);
const DECLARE_ORIGINAL = process.env.WECHAT_DECLARE_ORIGINAL !== 'false';

const SELECTORS = {
  loggedIn: [
    '.account_box',
    '.main_bd',
    '.weui-desktop-account',
    '#headerBar',
    '.account_nickname',
    '.weui-desktop-account__nickname',
  ],
  // 后台「新建」入口（文案随版本变化，尽量宽）
  newPostEntry: [
    'a:has-text("新建图文")',
    'button:has-text("新建图文")',
    'a:has-text("写新图文")',
    'a:has-text("图文消息")',
    'span:has-text("新建图文")',
    '[title="新建图文消息"]',
    'a:has-text("新的创作")',
    'a:has-text("开始创作")',
    '.new-creation__menu-item:has-text("图文")',
    'a[href*="appmsg_edit"]',
    'a[href*="type=10"]',
  ],
  // 真实 DOM（2026-07 调试截图确认）:
  // 标题: textarea#title.js_title  或  div.ProseMirror[placeholder=请在这里输入标题]
  // 正文: div.ProseMirror（第二个，非标题）
  // 保存: #js_submit button > span.send_wording「保存为草稿」（在页面底部，需滚动）
  // 发表: #js_send button.mass_send「发表」
  titleInput: [
    'textarea#title',
    'textarea.js_title',
    'textarea.js_article_title',
    'textarea[name="title"]',
    'textarea[placeholder*="请在这里输入标题"]',
    'textarea[placeholder*="标题"]',
  ],
  titleProse: [
    'div.ProseMirror[data-placeholder*="标题"]',
    'div.ProseMirror[data-placeholder*="请在这里输入标题"]',
  ],
  editor: [
    // 新版公众号正文是 ProseMirror，不是旧 UEditor iframe
    'div#edui1_iframeholder .ProseMirror',
    '.rich_media_content .ProseMirror',
    '.appmsg_editor .ProseMirror',
    'div.ProseMirror',
    'iframe#ueditor_0',
    'iframe[id*="ueditor"]',
    '[contenteditable="true"]',
  ],
  imgBtn: [
    'a:has-text("图片")',
    '.js_upload_img',
    '[class*="upload-img"]',
    'button:has-text("图片")',
    '#js_editor_insertimage',
  ],
  fileInput: [
    'input[type="file"]',
    'input[accept*="image"]',
  ],
  uploadSuccess: [
    '.js_img_box img',
    '.img_preview img',
    '[class*="upload-success"]',
    '.img_item img',
  ],
  saveBtn: [
    '#js_submit button',
    '#js_submit',
    'span#js_submit button',
    'button:has-text("保存为草稿")',
    'span.send_wording:has-text("保存为草稿")',
    '#js_save button',
    '#js_save',
  ],
  publishBtn: [
    '#js_send button.mass_send',
    '#js_send button',
    '#js_send',
    'button.mass_send',
    'button:has-text("发表")',
    'span.send_wording:has-text("发表")',
  ],
  confirmBtn: [
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("确认发送")',
    'button:has-text("继续发表")',
    '.weui-desktop-dialog button.weui-desktop-btn_primary',
    'button.weui-desktop-btn_primary',
  ],
  publishSuccess: [
    '#js_save_success',
    'text=已保存',
    'text=保存成功',
    'text=已发送',
    'text=发布成功',
    'text=发送成功',
    '.page_tips.success',
    '.toast_success',
  ],
};

/**
 * 发布内容到微信公众号
 */
async function publish(content) {
  const sessionName = `${PLATFORM}_default`;
  // 有界面模式：与扫码登录一致，降低会话失效概率
  const context = await browserService.createContext(sessionName, { headless: false });
  const page = await context.newPage();
  const log = (msg) => console.log(`[公众号] ${msg}`);

  let keepOpenOnError = false;
  try {
    // 先生成封面（独立浏览器），避免与发布会话抢 headless 实例
    if (!content.cover && !content.cover_path) {
      try {
        const preTitle = (content.title || '今日分享').slice(0, 64);
        const preAuthor = (content.author || content.wechat_author || DEFAULT_AUTHOR).slice(0, 8);
        content._generatedCoverPath = await generateWechatCover({
          title: preTitle,
          author: preAuthor,
          subtitle: content.niche_name || content.topic || '中年男人 · 生活与搞钱',
        });
        log(`预生成封面: ${content._generatedCoverPath}`);
      } catch (e) {
        log(`预生成封面失败（稍后重试）: ${e.message}`);
      }
    }

    // ======== 1. 进入后台首页 ========
    log('正在进入公众号后台...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForURL(
      (url) => url.href.includes('token=') || url.href.includes('cgi-bin'),
      { timeout: 20000 }
    ).catch(() => {});
    await browserService.humanDelay(1500, 2500);

    let token = extractTokenFromUrl(page.url());
    if (!token) {
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await browserService.humanDelay(1500, 2500);
      token = extractTokenFromUrl(page.url());
    }

    log(`检查登录态... 当前URL: ${page.url().slice(0, 140)}`);
    if (!(await checkLoginStatus(page))) {
      throw new Error('公众号登录态已过期，请重新授权（账号管理 → 解绑后重新绑定）');
    }
    if (!token) {
      throw new Error('无法从公众号后台 URL 提取 token，请重新绑定账号');
    }
    log(`✅ 登录态正常 token=${token.slice(0, 8)}...`);

    // ======== 2. 进入图文编辑器 ========
    await openArticleEditor(page, token, log);
    keepOpenOnError = true; // 已进入编辑器后，失败时多留一会儿

    // ======== 3. 填写标题 ========
    log('正在填写标题...');
    const title = content.title.length > 64 ? content.title.slice(0, 64) : content.title;
    const titleOk = await fillTitle(page, title, log);
    if (!titleOk) {
      await dumpDebug(page, 'no-title');
      throw new Error(
        `找不到标题输入框（当前页: ${page.url().slice(0, 120)}）。` +
        '已保存 server/debug/ 调试截图。'
      );
    }
    // 校验标题是否真的写进去了
    const titleValue = await readTitleValue(page);
    log(`标题回读: "${(titleValue || '').slice(0, 40)}"`);
    if (!titleValue || !titleValue.includes(title.slice(0, 4))) {
      log('⚠️ 标题回读为空或未匹配，尝试二次写入...');
      await fillTitle(page, title, log);
    }

    // ======== 3.5 作者 ========
    const author = (content.author || content.wechat_author || DEFAULT_AUTHOR).slice(0, 8);
    log(`正在填写作者: ${author}`);
    await fillAuthor(page, author, log);

    // ======== 4. 填写正文 ========
    if (content.body) {
      log('正在填写正文...');
      await fillBody(page, content.body, log);
      await browserService.humanDelay(800, 1200);
    }

    // ======== 5. 封面图（必填项，无则按标题自动生成） ========
    log('正在设置封面...');
    await setCoverImage(page, content, title, author, log);

    // ======== 5.5 声明原创 ========
    if (DECLARE_ORIGINAL && content.declare_original !== false) {
      log('正在声明原创...');
      await declareOriginal(page, log);
    } else {
      log('跳过声明原创（WECHAT_DECLARE_ORIGINAL=false 或 content.declare_original=false）');
    }

    // ======== 6. 上传正文图片 ========
    if (content.images && content.images.length > 0) {
      log(`准备上传 ${content.images.length} 张正文图片`);
      await uploadImages(page, content.images, log);
    }

    await browserService.humanDelay(1000, 2000);

    // ======== 7. 保存草稿（MVP 成功标准） ========
    log('正在保存为草稿...');
    const saved = await clickSaveDraft(page, log);
    if (saved) {
      await browserService.humanDelay(2500, 4000);
      // 等“已保存”提示
      await page.locator('#js_save_success, .page_tips.success').first()
        .waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      log('✅ 已点击保存草稿');
    } else {
      log('⚠️ 找不到保存按钮');
      await dumpDebug(page, 'no-save-btn');
      throw new Error('找不到「保存为草稿」按钮（#js_submit），请检查编辑器底部工具栏');
    }

    // ======== 8. 尝试发表（可选，失败不阻断草稿成功） ========
    // 默认只保存草稿；需要真正发表时设 WECHAT_TRY_PUBLISH=true
    if (process.env.WECHAT_TRY_PUBLISH === 'true') {
      log('尝试点击发表...');
      const publishedClick = await clickPublish(page, log);
      if (!publishedClick) {
        log('⚠️ 未找到/未点击发表，以草稿保存作为成功结果');
        await browserService.saveSession(context);
        return {
          postId: `wechat_draft_${Date.now()}`,
          url: page.url(),
          draftOnly: true,
          author,
        };
      }

      await browserService.humanDelay(1000, 2000);
      const confirmed = await clickFirst(page, SELECTORS.confirmBtn, log, '确认');
      if (confirmed) log('✅ 已点击确认');
      else log('⚠️ 未检测到二次确认弹窗');

      log('等待发布结果...');
      const result = await waitForPublishResult(page, log);
      await browserService.saveSession(context);

      log(`🎉 发布流程结束! postId=${result.postId || 'N/A'}`);
      return {
        postId: result.postId || `wechat_${Date.now()}`,
        url: page.url(),
        author,
      };
    }

    log('✅ 草稿保存完成（默认不点发表，设 WECHAT_TRY_PUBLISH=true 可尝试发表）');
    await browserService.saveSession(context);
    return {
      postId: `wechat_draft_${Date.now()}`,
      url: page.url(),
      draftOnly: true,
      author,
    };
  } catch (err) {
    log(`发布异常: ${err.message}`);
    await dumpDebug(page, 'publish-error').catch(() => {});
    if (keepOpenOnError) {
      log('失败后浏览器保留 15 秒，便于查看页面...');
      await browserService.humanDelay(15000, 15000);
    }
    throw err;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 打开图文编辑器：直接进 type=10 图文新建（已验证可用），减少误判与跳转次数
 */
async function openArticleEditor(page, token, log) {
  // 直接打开经典图文编辑器（调试已确认存在 textarea#title）
  const editorUrl = `${EDITOR_URL_TYPE10}${token}&timestamp=${Date.now()}`;
  log(`直接打开图文编辑器 type=10 ...`);
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 给 SPA / 编辑器脚本时间渲染（过短会导致误判“无标题框”然后关掉浏览器）
  await browserService.humanDelay(4000, 6000);

  if (isLoginPage(page.url())) {
    throw new Error('进入编辑器时被重定向到登录页，请重新绑定账号');
  }

  // 明确等待标题 textarea 挂载（不要求 visible）
  const attached = await page.waitForSelector('textarea#title, textarea.js_title, textarea[name="title"]', {
    state: 'attached',
    timeout: 20000,
  }).catch(() => null);

  if (attached || (await hasTitleField(page))) {
    log(`✅ 编辑器已就绪: ${page.url().slice(0, 140)}`);
    // 再等 ProseMirror 渲染
    await page.waitForSelector('div.ProseMirror', { state: 'attached', timeout: 10000 }).catch(() => {});
    await browserService.humanDelay(1000, 1500);
    return;
  }

  // 兜底：回首页点新建，再试 type=77
  log('type=10 未检测到标题字段，尝试首页入口 / type=77 ...');
  await dumpDebug(page, 'editor-type10-miss');

  const homeWithToken = `${HOME_URL}&token=${token}`;
  await page.goto(homeWithToken, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await browserService.humanDelay(2000, 3000);
  const entry = await findFirstSelector(page, SELECTORS.newPostEntry);
  if (entry) {
    log(`点击入口: ${entry}`);
    await page.locator(entry).first().click({ force: true }).catch(() => page.click(entry).catch(() => {}));
    await browserService.humanDelay(4000, 6000);
    if (await hasTitleField(page)) {
      log(`✅ UI 进入编辑器成功`);
      return;
    }
  }

  const url77 = `${EDITOR_URL_TYPE77}${token}&timestamp=${Date.now()}`;
  await page.goto(url77, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await browserService.humanDelay(4000, 6000);
  await page.waitForSelector('textarea#title, textarea.js_title, div.ProseMirror', {
    state: 'attached',
    timeout: 15000,
  }).catch(() => {});

  if (!(await hasTitleField(page))) {
    await dumpDebug(page, 'open-editor-failed');
    // 失败时多留一会儿窗口，方便你看页面（不要“一闪就关”）
    log('编辑器检测失败，浏览器将保留 20 秒供查看...');
    await browserService.humanDelay(20000, 20000);
    throw new Error(
      `无法检测到标题编辑区（当前: ${page.url().slice(0, 120)}）。` +
      '已保存 server/debug/ 调试文件。'
    );
  }
  log(`✅ URL 进入编辑器成功 (type=77)`);
}

/**
 * 检测编辑器是否就绪。
 * 注意：textarea#title 常被 ProseMirror 盖住，Playwright isVisible() 会误判为不可见，
 * 因此用 attached + 存在性判断，不要强依赖 visible。
 */
async function hasTitleField(page) {
  // 等一下 SPA 渲染
  await page.waitForSelector(
    'textarea#title, textarea.js_title, textarea[name="title"], div.ProseMirror',
    { state: 'attached', timeout: 15000 }
  ).catch(() => {});

  const found = await page.evaluate(() => {
    const ta = document.querySelector('textarea#title, textarea.js_title, textarea[name="title"]');
    if (ta) return 'textarea#title';
    const pm = document.querySelector('div.ProseMirror');
    if (pm) return 'div.ProseMirror';
    const ph = Array.from(document.querySelectorAll('[placeholder],[data-placeholder]')).find((el) => {
      const p = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
      return p.includes('标题');
    });
    if (ph) return 'placeholder-title';
    return null;
  }).catch(() => null);

  return !!found;
}

/**
 * 像真人一样输入（公众号前端依赖 input 事件）
 */
async function typeIntoLocator(locator, text, { clear = true } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 5000 });
  await browserService.humanDelay(200, 400);
  if (clear) {
    await locator.press('Control+A').catch(() => {});
    await locator.press('Backspace').catch(() => {});
  }
  // fill 对 textarea 很快；keyboard 作兜底
  try {
    await locator.fill(text);
  } catch {
    if (typeof locator.pressSequentially === 'function') {
      await locator.pressSequentially(text, { delay: 20 });
    } else {
      await locator.type(text, { delay: 25 });
    }
  }
  // 触发 input/change
  await locator.evaluate((el, value) => {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, text).catch(() => {});
}

async function fillTitle(page, title, log) {
  // 0) 优先 DOM 直写 textarea#title（不依赖可见/点击，最稳）
  try {
    const ok = await page.evaluate((text) => {
      const el = document.querySelector('textarea#title, textarea.js_title, textarea[name="title"]');
      if (!el) return false;
      el.focus();
      el.value = text;
      // 同步 React/自研监听
      const proto = window.HTMLTextAreaElement?.prototype;
      const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }, title);
    if (ok) {
      log(`✅ 标题已写入 textarea#title: "${title.slice(0, 30)}"`);
    }
  } catch (err) {
    log(`evaluate 标题失败: ${err.message}`);
  }

  // 1) 再点 ProseMirror 标题区，让界面上也显示文字
  try {
    const byPh = page.locator(
      'div.ProseMirror[data-placeholder*="标题"], div.ProseMirror[data-placeholder*="请在这里输入标题"]'
    ).first();
    const target = (await byPh.count()) > 0 ? byPh : page.locator('div.ProseMirror').first();
    if ((await target.count()) > 0) {
      await target.click({ timeout: 5000, force: true });
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.type(title, { delay: 15 });
      log('✅ 标题已同步输入到 ProseMirror 显示层');
      return true;
    }
  } catch (err) {
    log(`ProseMirror 标题写入: ${err.message}`);
  }

  // 2) locator.fill 兜底
  for (const sel of SELECTORS.titleInput) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      await loc.fill(title, { force: true, timeout: 5000 });
      log(`✅ 标题 fill: ${sel}`);
      return true;
    } catch (err) {
      log(`标题选择器 ${sel} 失败: ${err.message}`);
    }
  }

  // 只要 textarea 有值就算成功
  const v = await readTitleValue(page);
  return !!(v && v.length > 0);
}

async function readTitleValue(page) {
  return page.evaluate(() => {
    const el = document.querySelector('textarea#title, textarea.js_title, textarea[name="title"]');
    if (el && el.value) return el.value;
    const pm = document.querySelector('div.ProseMirror');
    return pm ? (pm.innerText || '').trim() : '';
  }).catch(() => '');
}

/**
 * 填写作者：#author / input.js_author，最多 8 字
 */
async function fillAuthor(page, author, log) {
  const name = String(author || DEFAULT_AUTHOR).slice(0, 8);
  try {
    const ok = await page.evaluate((text) => {
      const el =
        document.querySelector('input#author') ||
        document.querySelector('input.js_author') ||
        document.querySelector('input[name="author"]');
      if (!el) return false;
      el.focus();
      el.value = text;
      const proto = window.HTMLInputElement?.prototype;
      const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }, name);

    if (ok) {
      const val = await page.evaluate(() => {
        const el =
          document.querySelector('input#author') ||
          document.querySelector('input.js_author');
        return el ? el.value : '';
      });
      log(`✅ 作者已填写: "${val || name}"`);
      return true;
    }

    // locator 兜底
    const loc = page.locator('input#author, input.js_author, input[name="author"]').first();
    if ((await loc.count()) > 0) {
      await loc.fill(name, { force: true, timeout: 5000 });
      log(`✅ 作者 fill: ${name}`);
      return true;
    }
    log('⚠️ 未找到作者输入框，继续后续流程');
    return false;
  } catch (err) {
    log(`⚠️ 填写作者失败: ${err.message}`);
    return false;
  }
}

/**
 * 解析封面本地路径：优先 content.cover / images[0]，否则按标题生成
 */
async function resolveCoverPath(content, title, author, log) {
  const candidates = [];
  if (content._generatedCoverPath) candidates.push(content._generatedCoverPath);
  if (content.cover) candidates.push(content.cover);
  if (content.cover_path) candidates.push(content.cover_path);
  if (content.images && content.images.length) {
    candidates.push(content.images[0].url || content.images[0]);
  }

  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    if (path.isAbsolute(c) && fs.existsSync(c)) return c;
    const asUpload = path.join(UPLOAD_DIR, path.basename(c.replace(/^\/uploads\//, '')));
    if (fs.existsSync(asUpload)) return asUpload;
    // 相对 uploads
    const rel = path.join(UPLOAD_DIR, c.replace(/^\/+/, ''));
    if (fs.existsSync(rel)) return rel;
  }

  log('无现成封面，按标题自动生成…');
  const generated = await generateWechatCover({
    title,
    author,
    subtitle: content.niche_name || content.topic || '中年男人 · 生活与搞钱',
  });
  log(`✅ 已生成封面: ${generated}`);
  return generated;
}

/**
 * 设置封面：点击「拖拽或选择封面」→ 本地上传 → 确认裁剪弹窗
 */
async function setCoverImage(page, content, title, author, log) {
  let coverPath;
  try {
    coverPath = await resolveCoverPath(content, title, author, log);
  } catch (err) {
    log(`⚠️ 封面准备失败: ${err.message}`);
    await dumpDebug(page, 'cover-prepare-failed');
    return false;
  }
  if (!coverPath || !fs.existsSync(coverPath)) {
    log('⚠️ 封面文件不存在，跳过');
    return false;
  }

  // 滚到封面区域
  await page.evaluate(() => {
    const el =
      document.querySelector('#js_cover_area') ||
      document.querySelector('#js_cover_description_area') ||
      document.querySelector('.js_cover_btn_area');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }).catch(() => {});
  await browserService.humanDelay(400, 700);

  // 若已有封面预览则跳过
  const hasCover = await page.evaluate(() => {
    const preview = document.querySelector('.js_cover_preview_new');
    if (!preview) return false;
    const style = window.getComputedStyle(preview);
    if (style.display === 'none') return false;
    const bg = preview.style.backgroundImage || '';
    return bg.includes('url') && !bg.includes('url("")') && !bg.includes('url(&quot;&quot;)');
  }).catch(() => false);
  if (hasCover && !content.force_cover) {
    log('检测到已有封面，跳过上传');
    return true;
  }

  // 监听 file chooser：点击封面区域
  try {
    const coverBtn = page.locator(
      '.js_cover_btn_area, #js_cover_area .select-cover__btn, #js_cover_area, text=拖拽或选择封面'
    ).first();

    // 优先：页面上 cover 区域内的 file input
    const coverFileInput = page.locator('#js_cover_area input[type="file"], .js_cover_btn_area input[type="file"]').first();
    if ((await coverFileInput.count()) > 0) {
      await coverFileInput.setInputFiles(coverPath);
      log('✅ 封面文件已通过 cover 区域 input 上传');
    } else {
      // filechooser 方式
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
        coverBtn.click({ timeout: 8000, force: true }).catch(async () => {
          await page.evaluate(() => {
            const el =
              document.querySelector('.js_cover_btn_area') ||
              document.querySelector('#js_cover_area .select-cover__btn');
            if (el) el.click();
          });
        }),
      ]);

      if (fileChooser) {
        await fileChooser.setFiles(coverPath);
        log('✅ 封面已通过 filechooser 选择');
      } else {
        // 点击后可能弹出菜单：本地上传
        const localUpload = page.locator(
          'text=本地上传, li:has-text("本地上传"), .tpl_dropdown_menu_item:has-text("本地上传")'
        ).first();
        if ((await localUpload.count()) > 0) {
          const inputInMenu = localUpload.locator('input[type="file"]').first();
          if ((await inputInMenu.count()) > 0) {
            await inputInMenu.setInputFiles(coverPath);
            log('✅ 封面经「本地上传」菜单 input 上传');
          } else {
            const [fc2] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
              localUpload.click({ force: true }),
            ]);
            if (fc2) {
              await fc2.setFiles(coverPath);
              log('✅ 封面经「本地上传」filechooser 上传');
            } else {
              // 全局找第一个可见 file input
              const anyInput = page.locator('input[type="file"][accept*="image"]').last();
              if ((await anyInput.count()) > 0) {
                await anyInput.setInputFiles(coverPath);
                log('✅ 封面经全局 file input 上传');
              } else {
                throw new Error('无法触发封面文件选择');
              }
            }
          }
        } else {
          // 直接找页面上任意 image file input
          const anyInput = page.locator('input[type="file"][accept*="image"]');
          const n = await anyInput.count();
          if (n > 0) {
            await anyInput.nth(n - 1).setInputFiles(coverPath);
            log('✅ 封面经末尾 file input 上传');
          } else {
            throw new Error('找不到封面上传入口');
          }
        }
      }
    }
  } catch (err) {
    log(`⚠️ 封面上传交互失败: ${err.message}`);
    await dumpDebug(page, 'cover-upload-failed');
    return false;
  }

  await browserService.humanDelay(1500, 2500);

  // 处理「编辑封面」裁剪弹窗：点完成/确定/下一步
  const cropOk = await confirmCoverCropDialog(page, log);
  if (!cropOk) {
    log('⚠️ 未确认到封面裁剪弹窗（可能已自动完成）');
  }

  // 等待封面预览出现
  await page.waitForFunction(() => {
    const preview = document.querySelector('.js_cover_preview_new');
    if (preview) {
      const style = window.getComputedStyle(preview);
      const bg = preview.style.backgroundImage || '';
      if (style.display !== 'none' && bg.includes('http')) return true;
    }
    const cdn = document.querySelector('input.js_cdn_url, input[name="cdn_url"]');
    if (cdn && cdn.value) return true;
    return false;
  }, { timeout: 25000 }).catch(() => null);

  const done = await page.evaluate(() => {
    const cdn = document.querySelector('input.js_cdn_url, input[name="cdn_url"]');
    if (cdn && cdn.value) return true;
    const preview = document.querySelector('.js_cover_preview_new');
    if (!preview) return false;
    const bg = preview.style.backgroundImage || '';
    return bg.includes('http') || bg.includes('mmbiz');
  }).catch(() => false);

  if (done) {
    log('✅ 封面设置成功');
    return true;
  }
  log('⚠️ 封面状态未确认成功，继续后续流程');
  await dumpDebug(page, 'cover-status-unknown');
  return false;
}

/**
 * 封面裁剪/编辑弹窗确认
 */
async function confirmCoverCropDialog(page, log) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    // 常见按钮文案
    const buttons = [
      page.getByRole('button', { name: /^(完成|确定|确认|下一步|保存)$/ }),
      page.locator('button:has-text("完成")'),
      page.locator('button:has-text("确定")'),
      page.locator('a:has-text("完成")'),
      page.locator('.weui-desktop-btn_primary:has-text("完成")'),
      page.locator('.weui-desktop-btn_primary:has-text("确定")'),
      page.locator('mp-image-edit-dialog button:has-text("完成")'),
      page.locator('[class*="image-edit"] button:has-text("完成")'),
      page.locator('[class*="image-edit"] button:has-text("确定")'),
    ];

    for (const loc of buttons) {
      try {
        if ((await loc.count()) === 0) continue;
        const first = loc.first();
        const visible = await first.isVisible().catch(() => false);
        if (!visible) continue;
        await first.click({ timeout: 3000 });
        log('✅ 已点击封面编辑确认按钮');
        await browserService.humanDelay(800, 1200);
        // 可能有两步（下一步 → 完成）
        continue;
      } catch { /* next */ }
    }

    // 弹窗是否还在
    const dialogVisible = await page.evaluate(() => {
      const dialogs = document.querySelectorAll(
        'mp-image-edit-dialog, .weui-desktop-dialog, [class*="image-edit"], [class*="crop"]'
      );
      return Array.from(dialogs).some((d) => {
        const s = window.getComputedStyle(d);
        return s.display !== 'none' && s.visibility !== 'hidden' && d.offsetParent !== null;
      });
    }).catch(() => false);

    if (!dialogVisible) {
      // 再点一次可能的完成
      return true;
    }
    await browserService.humanDelay(500, 800);
  }
  return false;
}

/**
 * 声明原创：点击「未声明」→ 处理 mp-claim-original-dialog
 */
async function declareOriginal(page, log) {
  try {
    // 已声明则跳过
    const already = await page.evaluate(() => {
      const open = document.querySelector('#js_original_open');
      if (open) {
        const s = window.getComputedStyle(open);
        if (s.display !== 'none' && open.offsetParent !== null) return true;
      }
      const unset = document.querySelector('.js_unset_original_title');
      if (unset && /已声明|原创/.test(unset.textContent || '') && !/未声明/.test(unset.textContent || '')) {
        return true;
      }
      return false;
    }).catch(() => false);

    if (already) {
      log('✅ 已是原创声明状态，跳过');
      return true;
    }

    await page.evaluate(() => {
      const el =
        document.querySelector('#js_original') ||
        document.querySelector('.js_original_apply_cell') ||
        document.querySelector('.js_unset_original_title');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }).catch(() => {});
    await browserService.humanDelay(300, 500);

    // 点击「未声明」开关区域
    const switchLocators = [
      page.locator('.js_unset_original_title'),
      page.locator('#js_original .js_original_apply.js_edit_ori'),
      page.locator('#js_original .setting-group__switch'),
      page.locator('text=未声明'),
      page.locator('#js_original'),
    ];

    let clicked = false;
    for (const loc of switchLocators) {
      try {
        if ((await loc.count()) === 0) continue;
        await loc.first().click({ timeout: 4000, force: true });
        clicked = true;
        log('已点击原创声明入口');
        break;
      } catch { /* next */ }
    }

    if (!clicked) {
      // JS 点击
      clicked = await page.evaluate(() => {
        const el =
          document.querySelector('.js_unset_original_title') ||
          document.querySelector('#js_original .js_edit_ori') ||
          document.querySelector('#js_original .setting-group__switch');
        if (!el) return false;
        el.click();
        return true;
      }).catch(() => false);
    }

    if (!clicked) {
      log('⚠️ 未找到原创声明入口');
      await dumpDebug(page, 'original-entry-miss');
      return false;
    }

    await browserService.humanDelay(1000, 1800);

    // 处理声明弹窗
    const dialogOk = await confirmOriginalDialog(page, log);
    if (!dialogOk) {
      log('⚠️ 原创声明弹窗未完整确认（账号可能无原创权限或 UI 变更）');
      await dumpDebug(page, 'original-dialog');
      // 不抛错，草稿仍可保存
      return false;
    }

    // 校验是否已声明
    await browserService.humanDelay(800, 1200);
    const declared = await page.evaluate(() => {
      const open = document.querySelector('#js_original_open');
      if (open) {
        const s = window.getComputedStyle(open);
        if (s.display !== 'none') return true;
      }
      const unset = document.querySelector('.js_unset_original_title');
      if (unset && /未声明/.test(unset.textContent || '')) return false;
      return !unset;
    }).catch(() => false);

    if (declared) {
      log('✅ 原创声明成功');
      return true;
    }
    log('⚠️ 原创声明状态未确认');
    return false;
  } catch (err) {
    log(`⚠️ 声明原创异常: ${err.message}`);
    await dumpDebug(page, 'original-error');
    return false;
  }
}

/**
 * 原创声明弹窗：勾选同意 + 点确定/声明
 */
async function confirmOriginalDialog(page, log) {
  const deadline = Date.now() + 25000;
  let agreed = false;
  let confirmed = false;

  while (Date.now() < deadline) {
    // 勾选协议
    if (!agreed) {
      const checks = [
        page.locator('mp-claim-original-dialog input[type="checkbox"]'),
        page.locator('.weui-desktop-dialog input[type="checkbox"]'),
        page.locator('label:has-text("同意") input[type="checkbox"]'),
        page.locator('label:has-text("原创") input[type="checkbox"]'),
        page.locator('text=我同意').locator('..').locator('input[type="checkbox"]'),
        page.locator('.weui-desktop-form__check-label input[type="checkbox"]'),
      ];
      for (const loc of checks) {
        try {
          const n = await loc.count();
          for (let i = 0; i < n; i++) {
            const c = loc.nth(i);
            if (!(await c.isVisible().catch(() => false))) continue;
            const isChecked = await c.isChecked().catch(() => false);
            if (!isChecked) {
              await c.check({ force: true }).catch(async () => {
                await c.click({ force: true });
              });
            }
            agreed = true;
            log('已勾选原创协议');
          }
        } catch { /* next */ }
      }

      // 点「同意」文案本身
      if (!agreed) {
        const agreeText = page.locator(
          'label:has-text("同意"), span:has-text("我同意"), div:has-text("同意《")'
        ).first();
        if ((await agreeText.count()) > 0 && (await agreeText.isVisible().catch(() => false))) {
          await agreeText.click({ force: true }).catch(() => {});
          agreed = true;
          log('已点击同意协议文案');
        }
      }
    }

    // 确认按钮
    const confirmBtns = [
      page.getByRole('button', { name: /^(声明原创|确定|确认|同意并声明|下一步)$/ }),
      page.locator('button:has-text("声明原创")'),
      page.locator('button:has-text("同意并声明")'),
      page.locator('button:has-text("确定")'),
      page.locator('.weui-desktop-dialog .weui-desktop-btn_primary'),
      page.locator('mp-claim-original-dialog button.weui-desktop-btn_primary'),
      page.locator('mp-claim-original-dialog button:has-text("确定")'),
    ];

    for (const loc of confirmBtns) {
      try {
        if ((await loc.count()) === 0) continue;
        const btn = loc.first();
        if (!(await btn.isVisible().catch(() => false))) continue;
        const disabled = await btn.isDisabled().catch(() => false);
        if (disabled) continue;
        await btn.click({ timeout: 3000 });
        confirmed = true;
        log('已点击原创声明确认');
        await browserService.humanDelay(1000, 1500);
        break;
      } catch { /* next */ }
    }

    // 弹窗是否关闭
    const stillOpen = await page.evaluate(() => {
      const nodes = document.querySelectorAll(
        'mp-claim-original-dialog, .weui-desktop-dialog, [class*="claim-original"]'
      );
      return Array.from(nodes).some((n) => {
        const s = window.getComputedStyle(n);
        return s.display !== 'none' && s.visibility !== 'hidden' && (n.offsetWidth > 0 || n.offsetHeight > 0);
      });
    }).catch(() => false);

    if (confirmed && !stillOpen) return true;
    if (confirmed && stillOpen) {
      // 可能还有第二步
      await browserService.humanDelay(500, 800);
      continue;
    }

    // 没有弹窗出现：可能点击后直接声明，或权限不足
    if (!stillOpen && Date.now() > deadline - 20000) {
      // 等一会看是否出现
    }
    await browserService.humanDelay(600, 900);
  }

  return confirmed;
}

function isLoginPage(url) {
  return /login|passport|scanlogin/i.test(url) && !/token=/.test(url);
}

/**
 * 写入正文：新版是主页面 ProseMirror，不是 UEditor iframe
 */
async function fillBody(page, bodyHtml, log) {
  const plain = String(bodyHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!plain) {
    log('⚠️ 正文为空，跳过');
    return;
  }

  // --- 策略 A: 主页面第二个 ProseMirror（第一个通常是标题） ---
  try {
    const pms = page.locator('div.ProseMirror');
    const count = await pms.count();
    log(`页面 ProseMirror 数量: ${count}`);
    // 选“不是标题”的：高度更大 / 没有标题 placeholder
    let bodyLoc = null;
    for (let i = 0; i < count; i++) {
      const loc = pms.nth(i);
      const ph = await loc.getAttribute('data-placeholder').catch(() => '') || '';
      const box = await loc.boundingBox().catch(() => null);
      if (ph.includes('标题')) continue;
      if (box && box.height >= 40) {
        bodyLoc = loc;
        break;
      }
    }
    if (!bodyLoc && count >= 2) bodyLoc = pms.nth(1);
    if (!bodyLoc && count === 1) {
      // 只有一个时，点标题下方空白再找 contenteditable
      bodyLoc = pms.first();
    }

    if (bodyLoc) {
      await bodyLoc.scrollIntoViewIfNeeded().catch(() => {});
      await bodyLoc.click({ timeout: 5000 });
      await browserService.humanDelay(200, 400);
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      const paragraphs = plain.split('\n');
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i]) {
          await page.keyboard.type(paragraphs[i], { delay: 15 + Math.floor(Math.random() * 20) });
        }
        if (i < paragraphs.length - 1) {
          await page.keyboard.press('Enter');
        }
      }
      log(`✅ 正文已键盘输入到 ProseMirror (${plain.length} 字符)`);
      return;
    }
  } catch (err) {
    log(`ProseMirror 正文输入失败: ${err.message}`);
  }

  // --- 策略 B: evaluate 写所有非标题 ProseMirror ---
  try {
    const ok = await page.evaluate((text) => {
      const nodes = Array.from(document.querySelectorAll('div.ProseMirror'));
      const target =
        nodes.find((n) => {
          const ph = n.getAttribute('data-placeholder') || '';
          return !ph.includes('标题') && n.getBoundingClientRect().height >= 40;
        }) || nodes[1] || nodes[0];
      if (!target) return false;
      target.focus();
      target.innerHTML = text.split('\n').map((l) => `<p>${l || '<br>'}</p>`).join('');
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      return true;
    }, plain);
    if (ok) {
      log(`✅ 正文已 evaluate 写入 ProseMirror (${plain.length} 字符)`);
      return;
    }
  } catch (err) {
    log(`evaluate 正文失败: ${err.message}`);
  }

  // --- 策略 C: 旧 UEditor iframe ---
  try {
    const iframeEl = await page.$('iframe#ueditor_0, iframe[id*="ueditor"]');
    if (iframeEl) {
      const frame = await iframeEl.contentFrame();
      if (frame) {
        await frame.evaluate((text) => {
          const t = document.querySelector('[contenteditable="true"]') || document.body;
          t.focus();
          t.innerHTML = text.split('\n').map((l) => `<p>${l || '<br>'}</p>`).join('');
        }, plain);
        log(`✅ 正文已写入 UEditor iframe (${plain.length} 字符)`);
        return;
      }
    }
  } catch (err) {
    log(`UEditor 写入失败: ${err.message}`);
  }

  log('⚠️ 正文填写全部策略失败');
  await dumpDebug(page, 'body-fill-failed');
}

/**
 * 保存为草稿：#js_submit 在页面底部，必须先滚动
 */
async function clickSaveDraft(page, log) {
  // 滚到底部工具栏
  await page.evaluate(() => {
    const bar = document.querySelector('#bottom_main, #js_submit, .tool_area_wrp');
    if (bar) bar.scrollIntoView({ block: 'center', behavior: 'instant' });
    else window.scrollTo(0, document.body.scrollHeight);
  }).catch(() => {});
  await browserService.humanDelay(500, 800);

  // 优先精确 id
  const candidates = [
    page.locator('#js_submit button'),
    page.locator('#js_submit'),
    page.locator('span#js_submit button'),
    page.getByRole('button', { name: /保存为草稿/ }),
    page.locator('button:has-text("保存为草稿")'),
    page.locator('span.send_wording:has-text("保存为草稿")'),
  ];

  for (const loc of candidates) {
    try {
      if ((await loc.count()) === 0) continue;
      const target = loc.first();
      await target.scrollIntoViewIfNeeded().catch(() => {});
      // 若点到 span，点父级 button
      const tag = await target.evaluate((el) => el.tagName).catch(() => '');
      if (tag === 'SPAN') {
        const btn = target.locator('xpath=ancestor::button[1]');
        if ((await btn.count()) > 0) {
          await btn.click({ timeout: 5000 });
          log('已点击保存为草稿 (span→button)');
          return true;
        }
      }
      await target.click({ timeout: 5000 });
      log('已点击保存为草稿');
      return true;
    } catch (err) {
      log(`保存按钮尝试失败: ${err.message}`);
    }
  }

  // force click via JS
  const forced = await page.evaluate(() => {
    const root = document.querySelector('#js_submit');
    if (!root) return false;
    const btn = root.tagName === 'BUTTON' ? root : root.querySelector('button') || root;
    btn.click();
    return true;
  }).catch(() => false);
  if (forced) {
    log('已 JS 强制点击 #js_submit');
    return true;
  }
  return false;
}

async function clickPublish(page, log) {
  await page.evaluate(() => {
    const bar = document.querySelector('#bottom_main, #js_send');
    if (bar) bar.scrollIntoView({ block: 'center', behavior: 'instant' });
  }).catch(() => {});
  await browserService.humanDelay(300, 500);

  const candidates = [
    page.locator('#js_send button.mass_send'),
    page.locator('#js_send button'),
    page.locator('button.mass_send'),
    page.getByRole('button', { name: /^发表$/ }),
  ];
  for (const loc of candidates) {
    try {
      if ((await loc.count()) === 0) continue;
      await loc.first().click({ timeout: 5000 });
      log('已点击发表');
      return true;
    } catch { /* next */ }
  }
  return false;
}

async function uploadImages(page, images, log) {
  const imgBtnSelector = await findFirstSelector(page, SELECTORS.imgBtn);
  if (!imgBtnSelector) {
    log('⚠️ 找不到图片按钮，跳过图片上传');
    return;
  }

  const filePaths = images.map((img) => {
    const url = img.url || img;
    const filename = path.basename(url);
    return path.join(UPLOAD_DIR, filename);
  }).filter((fp) => {
    if (!fs.existsSync(fp)) {
      log(`⚠️ 图片文件不存在: ${fp}`);
      return false;
    }
    return true;
  });
  if (filePaths.length === 0) return;

  await page.click(imgBtnSelector);
  log('已点击图片按钮，等待文件选择框');

  const fileInput = await page.waitForSelector(SELECTORS.fileInput.join(','), { timeout: 10000 }).catch(() => null);
  if (!fileInput) {
    throw new Error('点击图片按钮后未出现文件选择框');
  }
  await fileInput.setInputFiles(filePaths);
  log(`已选择 ${filePaths.length} 张图片`);

  try {
    await page.waitForSelector(SELECTORS.uploadSuccess.join(','), { timeout: 60000 });
    log('✅ 图片上传完成');
  } catch {
    log('⚠️ 图片上传状态检测超时，继续后续流程');
  }
  await browserService.humanDelay(1500, 2500);
}

async function waitForPublishResult(page, log) {
  const result = { postId: null };
  for (const sel of SELECTORS.publishSuccess) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 20000 });
      if (el) {
        log('检测到成功提示');
        return result;
      }
    } catch { /* continue */ }
  }
  try {
    await page.waitForFunction(
      () => window.location.href.includes('appmsg_list') || window.location.href.includes('send'),
      { timeout: 15000 }
    );
    log('检测到页面跳转至列表页');
    return result;
  } catch { /* continue */ }
  log('⚠️ 未检测到明确发布结果，假定流程已完成');
  return result;
}

async function clickFirst(page, selectors, log, label) {
  const sel = await findFirstSelector(page, selectors);
  if (!sel) return false;
  try {
    await page.click(sel);
    log(`已点击${label}: ${sel}`);
    return true;
  } catch {
    try {
      await page.locator(sel).first().click({ force: true });
      log(`已强制点击${label}: ${sel}`);
      return true;
    } catch {
      return false;
    }
  }
}

function extractTokenFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

async function checkLoginStatus(page) {
  const url = page.url();
  if (url.includes('token=') || /mp\.weixin\.qq\.com\/cgi-bin\//.test(url)) {
    return true;
  }
  if (isLoginPage(url)) return false;

  for (const sel of SELECTORS.loggedIn) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => true))) return true;
    } catch { /* ignore */ }
  }

  try {
    const cookies = await page.context().cookies('https://mp.weixin.qq.com');
    const hasSession = cookies.some(
      (c) => (c.name === 'slave_sid' || c.name === 'data_ticket' || c.name === 'slave_user') && c.value
    );
    if (hasSession && !isLoginPage(url)) return true;
  } catch { /* ignore */ }

  return false;
}

async function findFirstSelector(page, selectorList) {
  for (const sel of selectorList) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) return sel;
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function dumpDebug(page, tag) {
  try {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `wechat-${tag}-${stamp}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    fs.writeFileSync(`${base}.html`, html.slice(0, 500000), 'utf8');
    fs.writeFileSync(`${base}.url.txt`, page.url(), 'utf8');
    // 记录可见 input / contenteditable 便于改选择器
    const meta = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          name: el.getAttribute('name'),
          placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
          className: String(el.className || '').slice(0, 120),
          visible: !!(el.offsetWidth || el.offsetHeight),
        }));
      return { title: document.title, inputs, frames: window.frames?.length };
    }).catch(() => ({}));
    fs.writeFileSync(`${base}.meta.json`, JSON.stringify(meta, null, 2), 'utf8');
    console.log(`[公众号] 调试文件已写入: ${base}.*`);
  } catch (err) {
    console.warn('[公众号] 写调试文件失败:', err.message);
  }
}

module.exports = {
  name: NAME,
  platform: PLATFORM,
  publish,
  checkLoginStatus,
};
