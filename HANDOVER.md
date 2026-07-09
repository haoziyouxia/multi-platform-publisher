# 项目交接文档 — 多平台内容分发工具一期 MVP

> **交接日期**: 2026-06-26  
> **交接人**: momo（产品）  
> **仓库地址**: https://github.com/haoziyouxia/multi-platform-publisher  
> **项目资料库**: tdrive → 产品文档/  
> **一句话**: 个人创作者的 Web 管理后台，一次编辑、一键分发到小红书 + 公众号 + 今日头条。

---

## 一、当前进度总览

| 阶段 | 状态 | 产出物 |
|------|:--:|------|
| 需求规划 | ✅ 完成 | 需求概要（竞品调研 + 平台可行性 + 功能清单） |
| PRD 撰写 | ✅ 完成 | 33 条 EARS 需求 + 流程 + 交互 + 验收标准 |
| 设计与研发评审 | ✅ 完成 | 评审材料（议题 + 页面清单 + 技术风险） |
| 研发任务拆解 | ✅ 完成 | 16 个任务 + 依赖图 + Sprint 规划 |
| 测试用例 | ✅ 完成 | 44 功能 + 9 边界 + 9 异常 + 验收清单 |
| 浏览器自动化预研 | ✅ 完成 | Playwright 三平台验证跑通，反检测通过 |
| **前后端项目骨架** | ✅ 完成 | 后端 Express + SQLite + 三平台发布器骨架；前端 React + TipTap 编辑器 |
| 账号管理模块 | ⏳ 待开发 | API 已就绪，前端页面已就绪，需接入真实扫码登录 |
| 内容编辑器完善 | ⏳ 待开发 | TipTap 已集成，需补全草稿保存、差异化编辑 |
| 三平台发布引擎 | ⏳ 待开发 | 发布器骨架已写，需用真实账号调试选择器 |
| 发布历史 + 状态追踪 | ⏳ 待开发 | API 已就绪，前端页面已就绪，需接入 WebSocket |
| 测试 + 上线 | ⏳ 待开发 | 测试用例已备好 |

---

## 二、快速启动

### 环境要求

- Node.js >= 18
- npm 或 pnpm

### 启动后端

```bash
cd server
cp .env.example .env        # 配置环境变量
npm install
npm run migrate             # 初始化数据库（首次）
npm run dev                 # 启动开发服务 → http://localhost:3000
```

### 启动前端

```bash
cd client
npm install
npm run dev                 # 启动开发服务 → http://localhost:5173
```

### 验证

```bash
# 后端健康检查
curl http://localhost:3000/api/health
# 应返回: {"status":"ok","timestamp":"..."}

# 前端打开浏览器访问
# http://localhost:5173
```

---

## 三、代码结构

```
multi-platform-publisher/
│
├── docs/                           # → 见根目录 .md 文件
│
├── server/                         # 后端 (Node.js + Express)
│   ├── .env.example                # 环境变量模板
│   ├── package.json
│   └── src/
│       ├── app.js                  # 应用入口（Express + CORS + 路由挂载）
│       │
│       ├── models/
│       │   ├── db.js               # SQLite 连接（better-sqlite3）
│       │   └── migrate.js          # 数据库迁移脚本（建表 + 索引）
│       │
│       ├── routes/
│       │   ├── accounts.js         # 账号管理 API (GET/POST/PATCH/DELETE)
│       │   ├── content.js          # 内容管理 API (CRUD + 图片上传 multer)
│       │   └── publish.js          # 发布任务 API (发布/重试/历史)
│       │
│       └── services/
│           ├── browser-service.js      # Playwright 浏览器管理（实例池 + 会话持久化 + 反检测）
│           ├── publish-service.js      # 发布调度引擎（并行 + 失败隔离 + 状态更新）
│           ├── websocket-service.js    # WebSocket 实时进度推送
│           └── publishers/
│               ├── xiaohongshu.js      # 小红书发布器（骨架 + 选择器）
│               ├── wechat.js           # 公众号发布器（骨架 + 选择器）
│               └── toutiao.js          # 头条号发布器（骨架 + 选择器）
│
├── client/                         # 前端 (React + TypeScript + Vite)
│   ├── package.json
│   ├── vite.config.ts              # Vite 配置（含 API 代理）
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx                # React 入口
│       ├── App.tsx                 # 路由 + 侧边栏布局
│       ├── index.css               # 全局样式 + CSS 变量
│       │
│       ├── pages/
│       │   ├── EditorPage.tsx      # 内容编辑页（TipTap 编辑器 + 图片上传 + 发布）
│       │   ├── AccountsPage.tsx    # 账号管理页（三平台绑定卡片）
│       │   └── HistoryPage.tsx     # 发布历史页（列表 + 筛选）
│       │
│       ├── components/
│       │   ├── PlatformSelector.tsx    # 平台选择开关组件
│       │   └── PublishProgress.tsx     # 发布进度组件（WebSocket 实时）
│       │
│       └── services/
│           └── api.ts              # Axios 封装（统一 baseURL + 错误拦截）
│
├── browser-automation-research/    # 预研代码（保留参考）
│   ├── research.js                 # 三平台 Playwright 验证脚本
│   ├── REPORT.md                   # 预研结论报告
│   └── screenshots/                # 平台截图（.gitignore 排除）
│
├── *.md                            # 产品文档（6份，根目录）
├── ONBOARDING.md                   # 简版上手指引
├── README.md                       # 项目说明
└── .gitignore
```

---

## 四、数据库结构

### accounts（账号表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| platform | TEXT | `xiaohongshu` / `wechat` / `toutiao` |
| nickname | TEXT | 平台账号昵称 |
| avatar | TEXT | 头像 URL |
| status | TEXT | `active` / `expired` / `unbound` |
| session_path | TEXT | 浏览器会话文件路径 |
| account_info | TEXT | JSON，额外信息 |
| bound_at | DATETIME | 绑定时间 |
| expired_at | DATETIME | 过期时间 |

### contents（内容表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 标题 |
| body | TEXT | HTML 正文 |
| images | TEXT | JSON，图片路径数组 |
| is_unified | INTEGER | 1=统一内容，0=有差异化 |
| platform_variants | TEXT | JSON，各平台差异化内容 |
| status | TEXT | `draft` / `published` |

### publish_tasks（发布任务表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| content_id | TEXT FK | 关联 contents.id |
| platform | TEXT | 目标平台 |
| account_id | TEXT FK | 关联 accounts.id |
| status | TEXT | `pending` / `publishing` / `published` / `reviewing` / `rejected` / `failed` |
| error_message | TEXT | 失败原因 |
| platform_post_id | TEXT | 平台返回的文章 ID |
| submitted_at | DATETIME | 提交时间 |
| completed_at | DATETIME | 完成时间 |

---

## 五、API 接口清单

### 账号管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 获取已绑定账号列表 |
| GET | `/api/accounts/platform/:platform` | 按平台获取账号 |
| POST | `/api/accounts` | 创建账号绑定 |
| PATCH | `/api/accounts/:id` | 更新账号状态 |
| DELETE | `/api/accounts/:id` | 解绑账号 |

### 内容管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/content/upload` | 上传图片（multipart，最多9张，≤10MB） |
| POST | `/api/content` | 创建内容 |
| GET | `/api/content` | 获取内容列表（分页） |
| GET | `/api/content/:id` | 获取单条内容 |
| PUT | `/api/content/:id` | 更新内容 |
| DELETE | `/api/content/:id` | 删除内容 |

### 发布任务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/publish` | 执行发布（传入 content_id + platforms 数组） |
| GET | `/api/publish/:taskId/status` | 查询发布状态 |
| POST | `/api/publish/:taskId/retry` | 重试失败的发布任务 |
| GET | `/api/publish/history` | 发布历史（支持 platform/status 筛选） |

### WebSocket

| 路径 | 说明 |
|------|------|
| `/ws` | 实时推送发布进度，消息格式：`{type: "publish_progress", task_id, platform, status, message}` |

---

## 六、待开发任务（按优先级排序）

### P0 — MVP 必须完成

| # | 任务 | 当前状态 | 具体要做什么 | 预估 |
|:--:|------|:--:|------|:--:|
| 1 | **账号绑定真实流程** | 骨架已就绪 | 在 `server/src/routes/accounts.js` 中接入浏览器自动化：启动浏览器 → 展示扫码页 → 轮询登录状态 → 保存会话 → 写入数据库 | 2d |
| 2 | **小红书发布器调试** | 骨架已就绪 | 用真实账号在 `server/src/services/publishers/xiaohongshu.js` 中调试选择器：上传图片、填写标题正文、点击发布、等待结果 | 2d |
| 3 | **公众号发布器调试** | 骨架已就绪 | 同上，在 `wechat.js` 中调试。注意公众号有草稿箱流程：先保存草稿再群发 | 2d |
| 4 | **头条号发布器调试** | 骨架已就绪 | 同上，在 `toutiao.js` 中调试。参考 `browser-automation-research/` 中的预研结论 | 2d |
| 5 | **草稿自动保存** | 未开始 | 前端 `EditorPage.tsx` 中添加防抖自动保存到 localStorage + 后端 API | 0.5d |
| 6 | **图片格式校验** | 后端已有 multer 限制 | 在发布前增加各平台图片比例校验（小红书 3:4、公众号 2.35:1、头条 ≥600×400） | 0.5d |
| 7 | **异常处理完善** | 未开始 | 网络中断恢复、发布超时、连续失败告警、浏览器崩溃恢复 | 1.5d |

### P1 — MVP 尽量完成

| # | 任务 | 当前状态 | 具体要做什么 | 预估 |
|:--:|------|:--:|------|:--:|
| 8 | **差异化编辑** | 数据库已支持 | 前端增加平台标签切换 + 独立编辑模式 + "已自定义"标识 | 1.5d |
| 9 | **发布前预览** | 未开始 | 各平台模拟效果渲染面板 | 1.5d |
| 10 | **发布状态轮询** | WebSocket 已就绪 | 后端定时轮询平台审核状态，前端通过 WS 接收更新 | 1d |
| 11 | **登录态过期检测** | 未开始 | 后端定时检查会话有效性，过期时标记账号状态，前端展示"需重新授权" | 0.5d |

### P2 — 后续迭代

| # | 任务 | 说明 |
|:--:|------|------|
| 12 | 图片自动适配裁剪 | 自动裁剪/调整尺寸适配各平台 |
| 13 | 定时发布 | 预设时间自动触发 |
| 14 | 基础数据分析 | 阅读量/互动数据回传 |

---

## 七、关键技术说明

### 1. 浏览器自动化方案

三个平台都没有官方图文发布 API，统一使用 **Playwright + stealth 插件** 模拟浏览器操作。

```
用户点击发布
  → publish-service.js 并行调度
    → publishers/xiaohongshu.js 启动浏览器 → 加载会话 → 操作页面 → 发布
    → publishers/wechat.js       同上
    → publishers/toutiao.js      同上
  → WebSocket 实时推送进度到前端
```

**会话持久化**: 首次扫码登录后，浏览器 Cookie/Session 保存到 `server/sessions/` 目录。下次发布时加载会话，无需重新登录。

**反检测**: 使用 `playwright-extra` + `puppeteer-extra-plugin-stealth` 隐藏自动化特征。预研已验证 `navigator.webdriver = false`。

**关键文件**: `server/src/services/browser-service.js`

### 2. 选择器维护

三平台发布器中的 CSS 选择器（如 `input[type="file"]`、`button:has-text("发布")`）可能因平台改版而失效。建议：

- 将选择器提取到配置文件 `server/src/config/selectors.json`
- 加入选择器失效告警
- 对关键选择器做模糊匹配兜底

### 3. 前端编辑器

使用 [TipTap](https://tiptap.dev/) 富文本编辑器，已集成：
- 基本格式（加粗、斜体、列表）
- 图片插入
- 占位提示

**待补全**: 粘贴清洗（去除 Word/网页冗余样式）、草稿自动保存、差异化编辑模式。

### 4. 实时进度

后端通过 WebSocket（`/ws`）向前端推送发布进度。前端 `PublishProgress.tsx` 组件已接入 WebSocket 监听。

---

## 八、注意事项

### ⚠️ 平台风险

| 风险 | 应对 |
|------|------|
| 小红书/头条风控升级 | 随机延迟 + 真人模拟输入 + 控制发布频率 |
| 平台页面改版导致选择器失效 | 选择器外置配置 + 监控告警 |
| 登录态频繁过期 | 会话持久化 + 到期前主动提醒用户 |
| 公众号个人订阅号群发次数限制 | 发布前校验次数（每天 1 次） |

### ⚠️ 开发顺序建议

```
第1步: 账号绑定流程（用真实账号跑通扫码登录 + 会话保存）
第2步: 选一个平台（建议公众号，页面最稳定）调通发布全流程
第3步: 依次调通另外两个平台
第4步: 草稿保存 + 图片校验 + 异常处理
第5步: 差异化编辑 + 预览 + 状态轮询
第6步: 联调测试 + 上线
```

### ⚠️ 需要准备的东西

- [ ] 三个平台的测试账号（小红书号、公众号、头条号各一个）
- [ ] 测试用图片（不同比例各几张）
- [ ] 服务器（部署用，需支持 headless Chrome）

---

## 九、产品文档索引

以下文档在项目根目录和项目资料库（tdrive → 产品文档/）中均可找到：

| 文档 | 用途 |
|------|------|
| `需求概要_多平台内容分发工具_一期.md` | 了解背景、竞品、平台可行性 |
| `PRD_多平台内容分发工具_一期MVP.md` | **核心文档**，33 条 EARS 需求 + 验收标准 |
| `评审材料_多平台内容分发工具_一期.md` | 技术方案、页面清单、风险矩阵 |
| `研发任务拆解_多平台内容分发工具_一期.md` | 16 个任务的依赖关系和工时预估 |
| `测试用例与验收清单_多平台内容分发工具_一期.md` | 44 个测试用例 + 验收清单 |
| `上线复盘报告_多平台内容分发工具_一期.md` | 上线后填充实际数据 |

---

## 十、联系人

| 角色 | 联系方式 |
|------|------|
| 产品（需求问题） | momo |
| 代码仓库 | https://github.com/haoziyouxia/multi-platform-publisher |
| 项目资料库 | tdrive → 产品文档/ |
| 项目事项看板 | CodeBuddy 项目内 → 事项 |

---

> 有需求问题找产品，有技术问题参考预研报告和评审材料。祝开发顺利 🚀
