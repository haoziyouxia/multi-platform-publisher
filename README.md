# 多平台内容分发工具 — 一期 MVP

面向个人创作者的 Web 管理后台，支持在小红书、微信公众号、今日头条三个平台进行统一的图文内容编辑与一键分发。

## 技术栈

- **前端**: React + TypeScript (推荐)
- **后端**: Node.js + Express/Koa
- **浏览器自动化**: Playwright + stealth 插件
- **数据库**: SQLite (MVP) / PostgreSQL (生产)

## 项目结构

```
.
├── docs/                          # 产品文档
│   ├── 需求概要_多平台内容分发工具_一期.md
│   ├── PRD_多平台内容分发工具_一期MVP.md
│   ├── 评审材料_多平台内容分发工具_一期.md
│   ├── 研发任务拆解_多平台内容分发工具_一期.md
│   ├── 测试用例与验收清单_多平台内容分发工具_一期.md
│   └── 上线复盘报告_多平台内容分发工具_一期.md
├── research/                      # 浏览器自动化预研
│   ├── research.js                # 预研脚本（已跑通）
│   ├── REPORT.md                  # 预研结论报告
│   └── screenshots/               # 平台截图
├── server/                        # 后端 (待开发)
├── client/                        # 前端 (待开发)
└── docker/                        # Docker 配置 (待开发)
```

## 快速开始

### 预研验证

```bash
cd research
npm install
npx playwright install chromium
NODE_OPTIONS="" node research.js all
```

### 启动开发

```bash
# 后端
cd server && npm install && npm run dev

# 前端
cd client && npm install && npm run dev
```

## 核心文档

所有产品文档位于 `docs/` 目录。开发前请先阅读：

1. **PRD** → 了解完整需求
2. **研发任务拆解** → 了解任务依赖关系
3. **预研报告** → 了解技术方案可行性

## 一期范围

- 小红书 + 微信公众号 + 今日头条
- 纯图文内容发布
- Web 管理后台
- 目标：1 个月内 MVP
