# AGENTS.md

## 项目概览

这是一个个人博客内容仓库 + 自建的 Hexo 文章管理后台，包含两部分：

- `_posts/` —— 博客的 Markdown 文章源文件（约 356 篇），大部分内容为中文，按 Hexo 的 Front Matter 格式编写。
- `hexo-admin/` —— 一个独立的 Node.js/Express 管理后台，用于浏览、编辑、新建、删除 `_posts/` 中的文章，并可在配置的 Hexo 站点目录下执行 `hexo generate` / `deploy` / `clean` 命令。

注意：本目录**不是**一个完整的 Hexo 站点（没有 `_config.yml`、`themes/`、`source/` 等），也不包含 Hexo 本体依赖。`_posts/` 是从 Hexo 站点 `source/_posts` 同步/存放的文章目录。仓库当前没有初始化 git。

真实的 Hexo 站点在远程服务器（Linux）的 `/root/blog`，文章位于 `/root/blog/source/_posts/`。`hexo-admin` 设计为拷贝到该服务器上运行，直接编辑真实站点文件并执行发布命令；本机（macOS）没有 Hexo 环境，不要在本机尝试验证 hexo 命令。

## 技术栈

- 后端：Node.js + Express 4（`hexo-admin/server.js`，单文件，CommonJS）
- 前端：纯 HTML + 原生 JS（`hexo-admin/public/`），无构建步骤
  - 样式：Tailwind CSS（CDN 引入，`index.html`）
  - Markdown 渲染：`marked`（前端 CDN + 后端 npm 包均使用）
- Front Matter 解析：`gray-matter`
- 无测试框架、无 lint 配置、无 CI 配置

## 构建与运行

```bash
cd hexo-admin
npm install
npm start          # 等价于 node server.js，npm run dev 相同
```

启动后访问 `http://localhost:4001`。

配置优先级：环境变量 > `hexo-admin/hexo-admin.config.json` > 默认值。配置文件字段：`sitePath`、`port`、`adminPassword`（当前 `sitePath` 指向服务器路径 `/root/blog`，本机启动时会回退使用仓库根目录的 `_posts/`）。

环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HEXO_SITE_PATH` | 真正的 Hexo 站点根目录 | 配置文件 `sitePath` → 上级目录（即本仓库根目录） |
| `PORT` | 服务端口 | 配置文件 `port` → `4001` |
| `ADMIN_PASSWORD` | 设置后启用 Bearer Token 鉴权 | 配置文件 `adminPassword` → 无（不鉴权） |

文章目录自动识别逻辑（`server.js` 的 `resolvePostsDir`）：优先 `<site>/source/_posts`，否则用 `<site>/_posts`。

`POST /api/hexo/:command` 会在站点根目录下执行 hexo 命令（优先站点本地 `node_modules/.bin/hexo`，否则 `npx hexo`，也能找到全局安装的 hexo）；`server` 命令被明确禁止通过 API 执行。`POST /api/hexo/publish` 是一键发布接口，串行执行 `clean → generate → deploy`，任一步失败即中断并返回已产生的输出。

## 代码结构

```
_posts/                  # Markdown 文章（内容主体，约 356 篇）
hexo-admin/
├── server.js            # Express 后端：REST API + 静态资源服务
├── hexo-admin.config.json  # 站点路径/端口/管理密码（被 .gitignore 忽略，由 hexo-admin.config.example.json 复制而来）
├── public/
│   ├── index.html       # 页面结构 + CDN 引入（Tailwind + typography、marked）
│   ├── app.js           # 前端逻辑：列表/筛选/编辑器/发布/401 密码处理（IIFE，无模块）
│   └── styles.css       # 少量自定义样式
├── package.json
└── README.md            # 使用说明（中文，含 API 表）
```

后端 API（详见 `hexo-admin/README.md`）：`GET /api/config`（公开）、`GET /api/posts`（支持 `q`/`tag`/`category`/`page`/`pageSize`）、`GET|PUT|DELETE /api/posts/:slug`、`POST /api/posts`、`POST /api/hexo/publish`、`POST /api/hexo/:command`、`GET /api/health`。除 `/api/config` 外所有 API 在启用密码后都经过 `requireAuth` 中间件鉴权；前端在收到 401 时弹窗输入密码并存入 sessionStorage。

## 文章（Front Matter）约定

`_posts/` 中的文章使用 YAML Front Matter，典型格式：

```yaml
---
title: 文章标题
date: 2024-04-17 09:58:25
tags:
- 标签
categories:
- 分类
---
```

- 文件名即 slug（去掉 `.md` 后缀），标签/分类多为中文。
- 新建文章的 slug 由标题生成，仅保留 `a-zA-Z0-9`、中文（`\u4e00-\u9fa5`）、`.`、`_`、`-`，其余字符替换为 `-`（见 `server.js` 的 `sanitizeSlug`）。
- 更新文章时未提供的 Front Matter 字段会保留原值（`PUT /api/posts/:slug` 的合并逻辑）。
- 修改文章时请保持 Front Matter 格式与既有文章一致，不要改动无关文章的元数据。

## 代码风格

- 后端与前端均为原生 JavaScript（CommonJS / 浏览器全局脚本），无 TypeScript、无打包器、无框架。
- 注释以英文为主，用户可见的 UI 文案和文档为中文。
- 保持简单直接：单文件后端、无构建前端是本项目有意为之的设计，不要引入构建步骤或框架，除非用户明确要求。

## 测试

项目没有任何自动化测试。验证后端改动的方式是手动启动服务并请求 API，例如：

```bash
cd hexo-admin && npm start
curl http://localhost:4001/api/health
curl http://localhost:4001/api/posts?pageSize=5
```

## 安全注意事项

- 默认**不启用鉴权**：只有设置了 `adminPassword`（配置文件）或 `ADMIN_PASSWORD` 环境变量才会要求 Bearer Token。鉴权通过 `app.use('/api', requireAuth)` 挂载，新增 API 路由时确保注册在该中间件之后（`/api/config` 之前的除外）。部署到公网必须启用。
- `POST /api/hexo/:command` 与 `POST /api/hexo/publish` 会以后台进程身份执行 shell 命令：虽然命令名有白名单/固定链路，但仍会以 shell 执行，切勿在未鉴权情况下暴露到公网。
- 不要修改 `resolveSitePath` / `resolvePostsDir` 的路径解析逻辑来放宽目录限制——`PUT`/`DELETE` 接口依赖它把文件操作限定在文章目录内。
- 删除文章的 API（`DELETE /api/posts/:slug`）不可恢复，仓库无 git 版本控制，改动文章文件前需谨慎。
