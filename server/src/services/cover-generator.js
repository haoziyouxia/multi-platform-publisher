/**
 * 公众号封面图生成（2.35:1，约 900×383）
 * 独立启动临时 Chromium，避免干扰发布用的浏览器实例。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const COVER_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'covers');

function ensureCoverDir() {
  if (!fs.existsSync(COVER_DIR)) {
    fs.mkdirSync(COVER_DIR, { recursive: true });
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ title?: string, author?: string, subtitle?: string, outPath?: string }} opts
 * @returns {Promise<string>} 本地绝对路径
 */
async function generateWechatCover(opts = {}) {
  ensureCoverDir();
  const title = (opts.title || '今日分享').slice(0, 36);
  const author = (opts.author || process.env.WECHAT_AUTHOR || '咸鱼翻炒炸').slice(0, 16);
  const subtitle = (opts.subtitle || '中年男人 · 生活与搞钱').slice(0, 24);
  const outPath =
    opts.outPath ||
    path.join(COVER_DIR, `cover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);

  // 独立浏览器，绝不复用发布会话的 browserInstance
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 383 },
    });
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 900px; height: 383px; overflow: hidden;
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 45%, #0f3460 100%);
    color: #fff;
    position: relative;
  }
  .glow {
    position: absolute; width: 420px; height: 420px; border-radius: 50%;
    background: radial-gradient(circle, rgba(233,69,96,0.35), transparent 70%);
    right: -80px; top: -120px;
  }
  .glow2 {
    position: absolute; width: 300px; height: 300px; border-radius: 50%;
    background: radial-gradient(circle, rgba(83,178,255,0.25), transparent 70%);
    left: -60px; bottom: -100px;
  }
  .inner {
    position: relative; z-index: 1;
    height: 100%;
    padding: 42px 48px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .badge {
    display: inline-block;
    font-size: 14px; letter-spacing: 2px;
    color: #ffd6a5; border: 1px solid rgba(255,214,165,0.45);
    padding: 6px 12px; border-radius: 999px;
    background: rgba(255,255,255,0.06);
    width: fit-content;
  }
  h1 {
    font-size: 40px; line-height: 1.28; font-weight: 700;
    max-width: 780px;
    text-shadow: 0 2px 18px rgba(0,0,0,0.35);
    word-break: break-word;
  }
  .foot {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 16px; color: rgba(255,255,255,0.78);
  }
  .author { color: #ffd6a5; font-weight: 600; }
  .bar {
    position: absolute; left: 0; bottom: 0; height: 6px; width: 100%;
    background: linear-gradient(90deg, #e94560, #f5a623, #53b2ff);
  }
</style></head>
<body>
  <div class="glow"></div>
  <div class="glow2"></div>
  <div class="inner">
    <div class="badge">${escapeHtml(subtitle)}</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="foot">
      <span class="author">${escapeHtml(author)}</span>
      <span>微信公众号</span>
    </div>
  </div>
  <div class="bar"></div>
</body></html>`;

    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: outPath,
      type: 'jpeg',
      quality: 88,
      clip: { x: 0, y: 0, width: 900, height: 383 },
    });
    await page.close().catch(() => {});
    return outPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  generateWechatCover,
  COVER_DIR,
};
