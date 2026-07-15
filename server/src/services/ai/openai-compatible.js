/**
 * OpenAI 兼容 Chat Completions 二创
 * 配置：AI_API_KEY / AI_BASE_URL / AI_MODEL
 */

function getConfig() {
  return {
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    timeout: Number(process.env.AI_TIMEOUT_MS || 120000),
  };
}

function buildPrompt({ topic, sourceTitle, sourceBody, sourceUrl, niche }) {
  const material = (sourceBody || '').slice(0, 6000);
  const nicheBlock = niche
    ? `
## 垂直赛道（必须贴合）
- 赛道名称：${niche.name}
- 目标读者：${niche.audience || ''}
- 文风要求：${niche.tone || ''}
- 可切入角度：${(niche.angles || []).join('；')}
写给「${niche.name}」人群看，标题与案例要像在跟这个群体说话，不要写成泛娱乐热搜解读。
`
    : `
## 赛道/话题
${topic || '综合热点'}
`;

  return `你是资深微信公众号编辑。请基于以下「参考素材」做二次创作，输出一篇适合公众号发表的原创向图文。

## 硬性要求
1. 必须换角度、换结构，禁止逐段洗稿或大段照抄。
2. 不要编造具体数据、机构名称与虚假引用；不确定就写得更谨慎。
3. 标题不超过 64 个汉字；标题要有代入感，适合目标读者点击。
4. 正文约 800～1500 字，用简洁 HTML：仅使用 <p>、<h2>、<ul>、<li>、<strong>。
5. 只输出 JSON，不要 markdown 代码围栏，不要其它说明文字。
JSON 格式：
{"title":"标题","body_html":"<p>段落</p>"}
${nicheBlock}
## 参考标题
${sourceTitle || ''}

## 参考链接
${sourceUrl || ''}

## 参考正文/摘要
${material || '（素材较少，请围绕赛道痛点做观点型公众号文章，并声明信息有限）'}
`;
}

function parseModelJson(text) {
  if (!text) throw new Error('模型返回为空');
  let s = text.trim();
  // 去掉 ```json 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const obj = JSON.parse(s);
  if (!obj.title || !obj.body_html) {
    throw new Error('模型 JSON 缺少 title 或 body_html');
  }
  return {
    title: String(obj.title).slice(0, 64),
    body_html: String(obj.body_html),
  };
}

/**
 * @returns {Promise<{ title: string, body_html: string, model: string }>}
 */
async function rewriteArticle(input) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    const err = new Error('未配置 AI_API_KEY（或 OPENAI_API_KEY），请在 server/.env 中配置');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: '你是严谨的中文公众号编辑，只输出合法 JSON。' },
          { role: 'user', content: buildPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI 接口错误 ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    try {
      const parsed = parseModelJson(content);
      return { ...parsed, model: cfg.model };
    } catch (parseErr) {
      // 兜底：整段当正文
      console.warn('[AI] JSON 解析失败，使用兜底:', parseErr.message);
      return {
        title: `${(input.topic || '热点').slice(0, 20)}：观察与思考`,
        body_html: `<p>${content.replace(/</g, '&lt;').slice(0, 5000)}</p>`,
        model: cfg.model,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  rewriteArticle,
  getConfig,
  buildPrompt,
};
