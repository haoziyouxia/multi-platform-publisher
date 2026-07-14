# 设计规格：多榜选题 → 搜索抓取 → AI 二创 → 公众号草稿

> **日期**: 2026-07-14  
> **状态**: 待用户确认后实现  
> **仓库**: multi-platform-publisher（在现有分发工程上扩展）  
> **一期发布目标**: 仅微信公众号草稿（已有发布器可复用）

---

## 1. 背景与目标

### 1.1 用户目标

从各平台**热门榜单**中发现选题，**自动搜索抓取**相关文章，用 **AI 二次创作** 成公众号图文，再进入现有「内容编辑 / 发布」链路保存为公众号草稿。

### 1.2 与现有工程的关系

| 现有能力 | 本功能用法 |
|----------|------------|
| 内容编辑 `EditorPage` | 接收二创结果，可人工再改 |
| `POST /api/content` | 落库图文 |
| 公众号发布器 `publishers/wechat.js` | 发布/存草稿 |
| Playwright 浏览器栈 | 拉热榜、搜索、抽正文 |

**不做推倒重来**：新增「选题二创」模块，发布底座保持不动。

### 1.3 一期成功标准

1. 能拉取并融合至少 2 个公开热榜，展示榜单列表。  
2. 用户选定**一个赛道（热词/话题）**后，自动搜索并展示候选文章列表。  
3. 用户选定一篇候选文，调用 AI 生成新标题 + 新正文。  
4. 结果可一键写入 `contents` 并打开/进入内容编辑；可触发公众号草稿发布。  
5. AI 通过 **OpenAI 兼容 API** 配置；后续可换 baseURL / model / key，无需改业务代码。

---

## 2. 决策记录（已确认）

| # | 议题 | 决定 |
|---|------|------|
| 1 | 热榜来源 | **多榜单融合**，用户每次先选**一个赛道**再往下走 |
| 2 | 找文 | **自动搜索抓取** |
| 3 | 二创 | **主要靠 AI** |
| 4 | 发布 | **公众号**（优先草稿） |
| 5 | 工程 | **本仓库继续做** |
| 6 | AI 厂商 | **先用 OpenAI 兼容（方案 A）**；配置化，后期可换其他 AI |

---

## 3. 多榜融合设计

### 3.1 第一期接入的榜源（自动化难度优先）

| 源 ID | 名称 | 拉取方式 | 权重（默认） | 备注 |
|-------|------|----------|:------------:|------|
| `baidu_hot` | 百度热搜 | Playwright 打开公开热搜页，解析词条 | 1.0 | 最稳，词条型 |
| `weibo_hot` | 微博热搜 | Playwright 公开热搜榜（失败则降级跳过） | 0.9 | 结构常变，允许部分失败 |
| `zhihu_hot` | 知乎热榜 | Playwright 热榜列表（标题+热度） | 1.1 | 偏长文向，利于公众号二创 |

> **明确不做（一期）**：小红书热搜、需登录的站内热榜、付费数据 API。

### 3.2 融合算法（简单可解释）

对每个源的 Top N（默认 N=20）：

1. **规范化话题键** `topic_key`：去空格、小写、去掉「#」与常见后缀（如「最新」「曝光」可选规则）。  
2. **单源分** `source_score`：  
   `source_score = weight * (N - rank + 1) / N`  
   （第 1 名最高，接近 0 最低）  
3. **融合分** `hot_score`：同一 `topic_key` 跨源相加。  
4. **展示**：按 `hot_score` 降序；卡片展示：标题/词条、来源标签（百度/微博/知乎）、融合分、原始排名列表。

### 3.3 赛道选择（一期交互）

- 列表每一项 = **一个赛道候选**（热词/话题）。  
- 用户**点击一项** = 「选中该赛道」，进入搜索抓取。  
- 一期**不做**「美妆/数码」等人工类目树；赛道即榜上话题。  
- 可选：搜索框本地过滤榜单（纯前端）。

### 3.4 刷新与缓存

- `POST /api/topics/refresh`：并行拉多榜 → 融合 → 写入 `hot_topics` 快照。  
- 默认缓存 **30 分钟**；未过期则 `GET` 读库；强制刷新带 `?force=1`。  
- 单榜失败：**不整单失败**，记录 `source_errors`，用成功源融合。

---

## 4. 自动搜索抓取

### 4.1 流程

```
选中赛道 topic
  → 构造查询词（默认 = 话题原文）
  → Playwright 打开搜索页（首选 Bing 网页搜索，备选百度）
  → 解析 Top K 条（默认 K=8）：title, url, snippet
  → 过滤黑名单域名 / 明显非文章页
  → 对前 M 条（默认 M=3）尝试打开正文抽取
  → 入库 source_articles，返回列表给前端
```

### 4.2 搜索引擎选择

| 优先级 | 引擎 | 原因 |
|:------:|------|------|
| 1 | Bing 网页搜索 | 结构相对稳定、中文结果可用 |
| 2 | 百度网页搜索 | 备选；验证码多时自动跳过 |

**一期不做**：搜狗微信公众号搜索（反爬与验证码重，留二期）。

### 4.3 正文抽取

- 策略：`readability` 类算法或「最大文本块」启发式 + 常见 article 选择器。  
- 失败：保留 `title + snippet`，标记 `body_status=partial`，仍允许 AI 二创（提示词中说明素材有限）。  
- 超时：单页 15s；总任务 90s。  
- 存储：原文 URL、标题、摘要、正文（截断至约 8000 字）、抓取时间。

### 4.4 合规与使用边界

- 仅供个人创作辅助；二创结果须改写，禁止原文搬运发表。  
- 控制频率：同一 topic 5 分钟内不重复全量抓取（除非 force）。  
- User-Agent：Windows Chrome（与现有 browser-service 一致）。

---

## 5. AI 二次创作

### 5.1 提供商抽象

```
RewriteProvider
  - rewrite({ topic, sourceTitle, sourceBody, sourceUrl }) → { title, bodyHtml, outline? }
```

**一期实现**：`OpenAICompatibleProvider`

环境变量（`server/.env`）：

```env
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=120000
```

后期换厂商：只改 env（兼容 OpenAI Chat Completions 的端点即可），**业务路由不改**。

### 5.2 提示词原则（固化在服务内，可配置覆盖）

- 角色：资深公众号编辑。  
- 输入：赛道、原文标题、原文（或摘要）、链接。  
- 要求：  
  - 新角度、新结构，**禁止逐段洗稿**；  
  - 输出公众号风格：标题 ≤ 64 字；正文 800～1500 字量级（可配置）；  
  - 分段清晰，可用简单 HTML（`<p>`、`<h2>`）；  
  - 不编造具体数据与虚假引用；不确定处弱化表述。  
- 输出：严格 JSON：`{ "title": "...", "body_html": "..." }`。

### 5.3 失败处理

- Key 未配置：API 返回 400，前端提示去配置 `.env`。  
- 超时/429：可重试 1 次；仍失败则返回错误，不写 contents。  
- JSON 解析失败：尝试从 markdown 代码块提取；再失败则整段当 body，title 用「赛道 + 观点」模板。

---

## 6. 与内容编辑 / 公众号发布的衔接

### 6.1 写入内容

`POST /api/rewrite/:jobId/apply`：

1. 读取二创结果；  
2. `INSERT contents`（title, body, images=[], status=draft）；  
3. 回写 `rewrite_jobs.content_id`；  
4. 返回 `content` 与前端跳转信息。

### 6.2 前端

- 新页：`/topics`「选题二创」  
  - Tab/区：热榜 → 候选文 → 二创预览  
- 二创预览可编辑标题/正文；  
- 按钮：  
  - **送入内容编辑** → `/` 并带 `contentId` 或 state 预填；  
  - **保存并发公众号草稿** → 调现有 `POST /api/publish`（platforms: `['wechat']`）。

### 6.3 编辑器小改

- `EditorPage` 支持从 URL/`location.state` 加载已有 `contentId`（GET `/api/content/:id`），避免只能空白新建。

---

## 7. 数据模型

### 7.1 `hot_topics`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| topic_key | TEXT | 规范化键 |
| title | TEXT | 展示标题 |
| hot_score | REAL | 融合分 |
| sources_json | TEXT | `[{source, rank, raw_title}]` |
| snapshot_at | DATETIME | 本批刷新时间 |
| created_at | DATETIME | |

索引：`snapshot_at`，`hot_score`。

### 7.2 `source_articles`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| topic_id | TEXT | 关联热词，可空 |
| topic_title | TEXT | 冗余赛道名 |
| title | TEXT | |
| url | TEXT | 唯一约束建议 url+topic |
| snippet | TEXT | |
| body | TEXT | 抽取正文 |
| body_status | TEXT | `full` / `partial` / `failed` |
| search_engine | TEXT | `bing` / `baidu` |
| created_at | DATETIME | |

### 7.3 `rewrite_jobs`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| topic_id | TEXT | |
| article_id | TEXT | |
| status | TEXT | `pending` / `running` / `done` / `failed` |
| model | TEXT | 使用的模型名 |
| input_snapshot | TEXT | JSON 输入摘要 |
| result_title | TEXT | |
| result_body | TEXT | |
| error_message | TEXT | |
| content_id | TEXT | 应用后关联 contents |
| created_at / updated_at | DATETIME | |

---

## 8. API 草案

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/topics` | 最新融合热榜（可 `?force=1` 触发刷新） |
| POST | `/api/topics/refresh` | 强制刷新多榜 |
| POST | `/api/topics/:id/search` | 对选中赛道搜索抓取文章 |
| GET | `/api/articles?topic_id=` | 候选文列表 |
| POST | `/api/rewrite` | body: `{ article_id }` 启动二创 |
| GET | `/api/rewrite/:id` | 查询二创状态与结果 |
| POST | `/api/rewrite/:id/apply` | 写入 contents |
| GET | `/api/content/:id` | 已有；编辑器加载用 |

---

## 9. 前端信息架构

侧栏新增：

```
✏️ 内容编辑
🔥 选题二创    ← 新
📋 发布历史
🔗 账号管理
```

选题二创页三步（同页纵向或步骤条）：

1. **热榜** — 刷新、列表、点选赛道  
2. **候选文章** — 自动加载 / 重新抓取、点选一篇  
3. **AI 二创** — 生成、预览编辑、送入编辑器 / 发公众号草稿  

---

## 10. 技术架构

```
client (React)
  TopicsPage
    → api /topics, /search, /rewrite, /apply
server
  routes/topics.js
  routes/rewrite.js
  services/hotlist/
    baidu.js, weibo.js, zhihu.js, merge.js
  services/search/
    bing-search.js, body-extract.js
  services/ai/
    openai-compatible.js, prompts.js
  复用 browser-service.js（建议 headless 拉榜/搜索，
  公众号发布仍可用 headed）
```

### 10.1 浏览器策略

| 场景 | headless | 说明 |
|------|:--------:|------|
| 热榜 / 搜索 / 抽正文 | true（默认可配） | 后台任务，不打扰用户 |
| 公众号登录 / 发布 | false | 已验证需要可见窗口 |

### 10.2 依赖增量

- 服务端：无强制新原生模块；AI 用 `fetch` 或轻量 HTTP。  
- 可选：`@mozilla/readability` + `jsdom` 做正文抽取（若体积可接受）。  
- 不引入 better-sqlite3（继续 node:sqlite）。

---

## 11. 实现分期

### Phase 1（本规格实现范围）

- [ ] DB 迁移三表  
- [ ] 百度 + 微博 + 知乎拉取与融合  
- [ ] Bing 搜索 + 正文抽取  
- [ ] OpenAI 兼容二创  
- [ ] Topics 页面三步流  
- [ ] apply → contents → 编辑器加载  
- [ ] 可选一键公众号草稿  

### Phase 2（明确延期）

- 搜狗微信专搜  
- 小红书热榜  
- 多模型 UI 配置页（一期仅 env）  
- 定时无人值守刷新与自动发布  
- 赛道类目树（美妆/数码等人工 taxonomy）

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 榜页改版 | 选择器集中配置；单源失败不阻断 |
| 搜索验证码 | 换引擎 / 降级仅返回标题链接 |
| AI 费用 | 默认小模型；正文截断 |
| 版权投诉 | 提示词强制改写；UI 提示勿原文发布 |
| 与发布并发抢浏览器 | 热榜任务与发布串行队列或分实例 |

---

## 13. 测试要点

1. 无网 / 单榜 404 时列表仍可用。  
2. 刷新后 `hot_topics` 条数 > 0。  
3. 选赛道后 `source_articles` ≥ 1（网络允许时）。  
4. 配置假 Key 时二创返回明确错误。  
5. apply 后 contents 可被 Editor 打开。  
6. 公众号已绑定账号时，草稿发布不回归（冒烟）。

---

## 14. 非目标（再次强调）

- 不做全自动「榜一直接群发」。  
- 不做视频赛道。  
- 不一期追求全网最全热榜。  

---

## 15. 待用户确认后的动作

1. 用户确认本规格无异议（或提出修改）。  
2. 编写实现计划（任务拆解）。  
3. 按 Phase 1 编码、联调。  
