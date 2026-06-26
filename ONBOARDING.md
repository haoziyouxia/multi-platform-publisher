# 开发者上手指引 — 多平台内容分发工具一期 MVP

> 写给接手开发的同事。5 分钟看完就能开工。

---

## 一、项目一句话

一个 Web 管理后台，让个人创作者**一次编辑、一键分发**到小红书、公众号、今日头条。

---

## 二、先看什么（按顺序）

| 顺序 | 文档 | 位置 | 时间 |
|:--:|------|------|:--:|
| 1 | **README.md** | 项目根目录 | 1 min |
| 2 | **需求概要** | `docs/需求概要_多平台内容分发工具_一期.md` | 3 min |
| 3 | **PRD** | `docs/PRD_多平台内容分发工具_一期MVP.md` | 10 min |
| 4 | **研发任务拆解** | `docs/研发任务拆解_多平台内容分发工具_一期.md` | 5 min |
| 5 | **预研报告** | `research/REPORT.md` | 3 min |

---

## 三、技术概要

### 方案

- **前端**: React + TypeScript（推荐，未定）
- **后端**: Node.js + Express/Koa
- **自动化**: Playwright + playwright-extra + stealth 插件
- **数据库**: SQLite（MVP）/ PostgreSQL（生产）

### 核心原理

三个平台都没有官方的图文发布 API，所以统一用 **Playwright 模拟浏览器操作**来发布内容。预研已跑通，三平台页面均可访问。

### 预研结果速查

```
✅ 小红书    → 首页/创作者中心可访问，扫码+手机号登录
✅ 公众号    → 后台可访问，登录后进入编辑器
✅ 今日头条  → 创作者平台可访问，未检测到反自动化
✅ 反检测    → navigator.webdriver = false
```

---

## 四、当前任务看板

| 优先级 | 事项 | 预估 | 依赖 |
|:--:|------|:--:|------|
| 🔴 P0 | 技术架构搭建（前后端骨架） | 2d | — |
| 🔴 P0 | 数据库设计（Account/Content/PublishTask） | 1d | 架构 |
| 🔴 P0 | 内容编辑器（富文本+图片上传+草稿） | 3d | 架构 |
| 🔴 P0 | 账号管理（三平台绑定/会话持久化） | 2d | 预研 |
| 🔴 P0 | 发布引擎 ×3（公众号/小红书/头条） | 6d | 预研 |
| 🟡 P1 | 发布历史+状态追踪 | 2.5d | 发布引擎 |
| 🟡 P1 | 差异化编辑+预览 | 3d | 编辑器 |

---

## 五、Sprint 建议

```
Week 1: 架构搭建 + 数据库 + 编辑器开发
Week 2: 三平台发布引擎（按公众号→头条→小红书顺序）
Week 3: 发布调度 + 前端整合 + 发布历史
Week 4: 联调测试 + 异常处理 + 上线
```

---

## 六、环境要求

- Node.js >= 18
- Playwright + Chromium
- Docker（部署用）

```bash
# 安装依赖
cd research && npm install && npx playwright install chromium

# 运行预研
NODE_OPTIONS="" node research.js all
```

---

## 七、代码仓库

GitHub 仓库地址：（待你创建后填入）

```bash
git remote add origin <你的GitHub仓库URL>
git push -u origin main
```

---

## 八、联系人

- 产品：momo（需求问题找我）
- 项目资料库：tdrive → 产品文档/

有任何问题直接找我。
