/**
 * T-01 浏览器自动化预研
 * 验证小红书、公众号、今日头条三平台的页面可访问性和关键元素
 * 
 * 注意：本脚本仅验证页面结构和元素定位，不执行实际登录和发布操作
 * （登录需要真实手机扫码，发布需要真实账号）
 * 
 * 用法: NODE_OPTIONS="" node research.js [xiaohongshu|wechat|toutiao|all]
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 启用反检测插件
chromium.use(StealthPlugin());

// 配置
const CONFIG = {
  headless: true,
  timeout: 30000,
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// 结果收集
const results = [];

/**
 * 通用浏览器启动
 */
async function createBrowser() {
  return await chromium.launch({
    headless: CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

/**
 * 截图并检查关键元素
 */
async function checkElements(page, platform, selectors) {
  const elementResults = {};
  for (const [name, selector] of Object.entries(selectors)) {
    try {
      const el = await page.waitForSelector(selector, { timeout: 10000 });
      elementResults[name] = el ? '✅ 找到' : '⚠️ 未找到';
    } catch (e) {
      elementResults[name] = `❌ 未找到 (${e.message.slice(0, 50)}...)`;
    }
  }
  return elementResults;
}

/**
 * ==========================================
 * 平台一：小红书创作中心
 * ==========================================
 */
async function researchXiaohongshu() {
  console.log('\n🔴 ===== 小红书平台预研 =====');
  const platformResult = {
    platform: '小红书',
    url: 'https://www.xiaohongshu.com',
    createUrl: 'https://creator.xiaohongshu.com',
    status: 'pending',
    findings: [],
    screenshots: [],
    elementResults: {},
    riskLevel: 'medium',
  };

  let browser;
  try {
    browser = await createBrowser();
    const context = await browser.newContext({
      viewport: CONFIG.viewport,
      userAgent: CONFIG.userAgent,
    });
    const page = await context.newPage();

    // 1. 访问小红书首页
    console.log('  📍 访问小红书首页...');
    await page.goto('https://www.xiaohongshu.com', { 
      waitUntil: 'networkidle', 
      timeout: CONFIG.timeout 
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/xiaohongshu_home.png', fullPage: false });
    platformResult.screenshots.push('xiaohongshu_home.png');
    
    const homeTitle = await page.title();
    platformResult.findings.push(`首页标题: ${homeTitle}`);
    console.log(`  首页标题: ${homeTitle}`);

    // 2. 检查登录入口
    const loginSelectors = {
      '登录按钮': 'text=登录',
      '扫码登录区域': '.qrcode, [class*="qrcode"], [class*="QR"]',
      '手机号登录': 'text=手机号登录',
      '页面主体': '#app, #root, .main-container',
    };
    platformResult.elementResults.home = await checkElements(page, 'xiaohongshu', loginSelectors);
    console.log('  首页元素检查:', JSON.stringify(platformResult.elementResults.home, null, 2));

    // 3. 尝试访问创作者中心（需要登录才能进入，但可以验证URL可达）
    console.log('  📍 访问小红书创作者中心...');
    try {
      await page.goto('https://creator.xiaohongshu.com', { 
        waitUntil: 'networkidle', 
        timeout: CONFIG.timeout 
      });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/xiaohongshu_creator.png', fullPage: false });
      platformResult.screenshots.push('xiaohongshu_creator.png');
      
      const creatorTitle = await page.title();
      platformResult.findings.push(`创作者中心标题: ${creatorTitle}`);
      
      // 检查是否有登录引导（未登录状态）
      const creatorSelectors = {
        '登录引导': 'text=登录, text=扫码, text=请先登录',
        '二维码区域': '.qrcode, img[alt*="二维码"], [class*="qr"]',
        '手机登录入口': 'text=手机号',
      };
      platformResult.elementResults.creator = await checkElements(page, 'xiaohongshu', creatorSelectors);
      console.log('  创作者中心元素:', JSON.stringify(platformResult.elementResults.creator, null, 2));
    } catch (e) {
      platformResult.findings.push(`创作者中心访问异常: ${e.message}`);
      console.log(`  ⚠️ 创作者中心: ${e.message}`);
    }

    platformResult.status = 'success';
    console.log('  ✅ 小红书预研完成');
  } catch (e) {
    platformResult.status = 'failed';
    platformResult.findings.push(`预研失败: ${e.message}`);
    console.log(`  ❌ 失败: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }

  results.push(platformResult);
  return platformResult;
}

/**
 * ==========================================
 * 平台二：微信公众号（MP后台）
 * ==========================================
 */
async function researchWechat() {
  console.log('\n🟢 ===== 微信公众号平台预研 =====');
  const platformResult = {
    platform: '微信公众号',
    url: 'https://mp.weixin.qq.com',
    createUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
    status: 'pending',
    findings: [],
    screenshots: [],
    elementResults: {},
    riskLevel: 'low',
  };

  let browser;
  try {
    browser = await createBrowser();
    const context = await browser.newContext({
      viewport: CONFIG.viewport,
      userAgent: CONFIG.userAgent,
    });
    const page = await context.newPage();

    // 1. 访问微信公众号后台首页
    console.log('  📍 访问微信公众号后台...');
    await page.goto('https://mp.weixin.qq.com', { 
      waitUntil: 'networkidle', 
      timeout: CONFIG.timeout 
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/wechat_mp_home.png', fullPage: false });
    platformResult.screenshots.push('wechat_mp_home.png');
    
    const homeTitle = await page.title();
    platformResult.findings.push(`首页标题: ${homeTitle}`);
    console.log(`  首页标题: ${homeTitle}`);

    // 2. 检查登录页面元素
    const loginSelectors = {
      '登录表单': '#app, .login_form, .login_panel, form',
      '账号输入': 'input[type="text"], input[name="account"], input[placeholder*="账号"]',
      '密码输入': 'input[type="password"]',
      '登录按钮': 'button:has-text("登录"), input[type="submit"]',
      '二维码登录': '.qrcode, img[class*="qrcode"], .js_qrcode',
    };
    platformResult.elementResults.login = await checkElements(page, 'wechat', loginSelectors);
    console.log('  登录页元素:', JSON.stringify(platformResult.elementResults.login, null, 2));

    // 3. 尝试访问新建图文页面（会被重定向到登录页）
    console.log('  📍 尝试访问新建图文页面...');
    try {
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77', {
        waitUntil: 'networkidle',
        timeout: CONFIG.timeout,
      });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/wechat_editor_redirect.png', fullPage: false });
      platformResult.screenshots.push('wechat_editor_redirect.png');
      
      const currentUrl = page.url();
      platformResult.findings.push(`访问编辑器后实际URL: ${currentUrl}`);
      console.log(`  编辑器页面跳转到: ${currentUrl}`);
      
      if (currentUrl.includes('login') || currentUrl.includes('redirect')) {
        platformResult.findings.push('未登录时正确重定向到登录页 ✅');
      }
    } catch (e) {
      platformResult.findings.push(`编辑器页面访问: ${e.message}`);
    }

    // 4. 分析页面结构（用于后续自动化）
    platformResult.findings.push('公众号后台采用 SPA 架构，核心操作在登录后进行');
    platformResult.findings.push('发布流程：上传素材(API) → 创建草稿(API) → 提交发布(API)');
    platformResult.findings.push('注意：个人订阅号需浏览器自动化模拟网页操作');
    
    platformResult.status = 'success';
    console.log('  ✅ 公众号预研完成');
  } catch (e) {
    platformResult.status = 'failed';
    platformResult.findings.push(`预研失败: ${e.message}`);
    console.log(`  ❌ 失败: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }

  results.push(platformResult);
  return platformResult;
}

/**
 * ==========================================
 * 平台三：今日头条创作者平台
 * ==========================================
 */
async function researchToutiao() {
  console.log('\n🟠 ===== 今日头条平台预研 =====');
  const platformResult = {
    platform: '今日头条',
    url: 'https://mp.toutiao.com',
    createUrl: 'https://mp.toutiao.com/profile_v4/',
    status: 'pending',
    findings: [],
    screenshots: [],
    elementResults: {},
    riskLevel: 'medium',
  };

  let browser;
  try {
    browser = await createBrowser();
    const context = await browser.newContext({
      viewport: CONFIG.viewport,
      userAgent: CONFIG.userAgent,
    });
    const page = await context.newPage();

    // 1. 访问头条号后台
    console.log('  📍 访问头条号创作者平台...');
    await page.goto('https://mp.toutiao.com', { 
      waitUntil: 'networkidle', 
      timeout: CONFIG.timeout 
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/toutiao_mp_home.png', fullPage: false });
    platformResult.screenshots.push('toutiao_mp_home.png');
    
    const homeTitle = await page.title();
    platformResult.findings.push(`首页标题: ${homeTitle}`);
    console.log(`  首页标题: ${homeTitle}`);

    // 2. 检查登录元素
    const loginSelectors = {
      '登录区域': '.login, [class*="login"], .auth-form',
      '手机号输入': 'input[type="tel"], input[placeholder*="手机"]',
      '扫码登录': 'img[alt*="二维码"], .qrcode, [class*="qr"]',
      '登录按钮': 'button:has-text("登录"), button:has-text("登 录")',
      '页面主体': '#root, .container, .main',
    };
    platformResult.elementResults.login = await checkElements(page, 'toutiao', loginSelectors);
    console.log('  登录页元素:', JSON.stringify(platformResult.elementResults.login, null, 2));

    // 3. 检查页面是否有反自动化检测
    const hasAutomationDetection = await page.evaluate(() => {
      return !!(
        navigator.webdriver ||
        document.querySelector('[class*="detect"]') ||
        document.querySelector('[class*="robot"]')
      );
    });
    platformResult.findings.push(`反自动化检测: ${hasAutomationDetection ? '⚠️ 检测到反自动化标识' : '✅ 未检测到明显反自动化标识'}`);
    console.log(`  反自动化检测: ${hasAutomationDetection}`);

    // 4. 尝试访问发布页面
    console.log('  📍 尝试访问内容发布页面...');
    try {
      // 头条号的内容管理页面
      await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', {
        waitUntil: 'networkidle',
        timeout: CONFIG.timeout,
      });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/toutiao_publish_redirect.png', fullPage: false });
      platformResult.screenshots.push('toutiao_publish_redirect.png');
      
      const currentUrl = page.url();
      platformResult.findings.push(`发布页实际URL: ${currentUrl}`);
      
      if (currentUrl.includes('login') || currentUrl.includes('redirect')) {
        platformResult.findings.push('未登录时正确重定向到登录页 ✅');
      }
    } catch (e) {
      platformResult.findings.push(`发布页面访问: ${e.message}`);
    }

    // 5. 参考开源方案
    platformResult.findings.push('参考开源方案: toutiao-ops (Playwright + stealth)');
    platformResult.findings.push('发布流程：登录 → 创作者平台 → 文章编辑 → 封面处理 → 发布');
    
    platformResult.status = 'success';
    console.log('  ✅ 今日头条预研完成');
  } catch (e) {
    platformResult.status = 'failed';
    platformResult.findings.push(`预研失败: ${e.message}`);
    console.log(`  ❌ 失败: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }

  results.push(platformResult);
  return platformResult;
}

/**
 * ==========================================
 * 反检测效果验证
 * ==========================================
 */
async function researchAntiDetection() {
  console.log('\n🛡️ ===== 反检测效果验证 =====');
  
  let browser;
  try {
    browser = await createBrowser();
    const context = await browser.newContext({
      viewport: CONFIG.viewport,
      userAgent: CONFIG.userAgent,
    });
    const page = await context.newPage();

    // 访问检测页面
    await page.goto('https://bot.sannysoft.com', { 
      waitUntil: 'networkidle', 
      timeout: CONFIG.timeout 
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/workspace/browser-automation-research/screenshots/antibot_detection.png', fullPage: true });

    // 执行反检测检查
    const detectionResults = await page.evaluate(() => {
      return {
        webdriver: navigator.webdriver,
        chrome: window.chrome ? '存在' : '不存在',
        plugins: navigator.plugins.length,
        languages: navigator.languages,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory || 'N/A',
        vendor: navigator.vendor,
      };
    });
    
    console.log('  反检测检查结果:', JSON.stringify(detectionResults, null, 2));
    
    results.push({
      platform: '反检测验证',
      status: 'success',
      findings: [
        `navigator.webdriver: ${detectionResults.webdriver}`,
        `window.chrome: ${detectionResults.chrome}`,
        `plugins数量: ${detectionResults.plugins}`,
        `navigator.vendor: ${detectionResults.vendor}`,
      ],
      elementResults: {},
      screenshots: ['antibot_detection.png'],
    });
    
    console.log('  ✅ 反检测验证完成');
  } catch (e) {
    console.log(`  ❌ 反检测验证失败: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * ==========================================
 * 主函数
 * ==========================================
 */
async function main() {
  const target = process.argv[2] || 'all';
  
  console.log('🚀 ===== 多平台内容分发 - 浏览器自动化预研 =====');
  console.log(`目标: ${target}`);
  console.log(`模式: ${CONFIG.headless ? 'Headless' : 'Headful'}`);
  console.log(`User-Agent: ${CONFIG.userAgent}`);
  console.log(`时间: ${new Date().toISOString()}\n`);

  // 创建截图目录
  const fs = require('fs');
  fs.mkdirSync('/workspace/browser-automation-research/screenshots', { recursive: true });

  try {
    if (target === 'xiaohongshu' || target === 'all') {
      await researchXiaohongshu();
    }
    if (target === 'wechat' || target === 'all') {
      await researchWechat();
    }
    if (target === 'toutiao' || target === 'all') {
      await researchToutiao();
    }
    if (target === 'all') {
      await researchAntiDetection();
    }
  } catch (e) {
    console.log(`\n❌ 预研异常: ${e.message}`);
  }

  // 输出汇总报告
  console.log('\n\n📊 ===== 预研结果汇总 =====\n');
  
  for (const r of results) {
    const emoji = r.status === 'success' ? '✅' : '❌';
    console.log(`${emoji} ${r.platform}`);
    console.log(`   风险等级: ${r.riskLevel || 'N/A'}`);
    console.log(`   发现: ${r.findings.length} 条`);
    for (const f of r.findings) {
      console.log(`     - ${f}`);
    }
    if (r.screenshots?.length) {
      console.log(`   截图: ${r.screenshots.join(', ')}`);
    }
    console.log('');
  }

  // 保存 JSON 报告
  const report = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    results,
  };
  fs.writeFileSync(
    '/workspace/browser-automation-research/research-report.json',
    JSON.stringify(report, null, 2)
  );
  console.log('📄 JSON 报告已保存: research-report.json');
  console.log('📸 截图目录: screenshots/');
}

main().catch(console.error);
