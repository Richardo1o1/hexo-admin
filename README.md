# Hexo Admin

一个独立的 Hexo 日志管理后台，支持浏览、编辑、新建、删除 Markdown 文章，并在配置的 Hexo 站点上执行 `hexo generate` / `hexo deploy` / `hexo clean` 等命令。

## 特性

- 📂 文章列表、搜索、按标签/分类筛选、分页
- ✏️ 分屏 Markdown 编辑器（源码 + 实时预览，滚动同步）
- 🏷️ 可视化 Front Matter 编辑（标题、日期、标签、分类）
- 🚀 一键发布：串行执行 `hexo clean → generate → deploy`，实时查看输出
- 🔧 也可单独执行 `hexo generate` / `deploy` / `clean`
- 🔒 基于 [Clerk](https://clerk.com) 的登录鉴权
- 💻 纯 HTML/JS 前端 + Node.js/Express 后端，无需构建步骤

## 目录结构

```
.
├── server.js          # Express 后端
├── package.json
├── .env.example       # 环境变量示例
├── README.md
└── public/            # 前端资源
    ├── index.html
    ├── app.js
    └── styles.css
```

## 安装

```bash
npm install
```

## 配置

所有配置均通过环境变量提供。本地开发可复制示例文件为 `.env`（由 `dotenv` 自动加载）：

```bash
cp .env.example .env
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HEXO_SITE_PATH` | Hexo 站点根目录 | 当前目录（开发回退） |
| `PORT` | 服务端口 | `4001` |
| `CLERK_PUBLISHABLE_KEY` | Clerk Publishable Key（前端初始化用） | 无 |
| `CLERK_SECRET_KEY` | Clerk Secret Key，设置后启用登录鉴权 | 无（不鉴权） |

> `.env` 已被 `.gitignore` 忽略（含站点路径和 Clerk 密钥），不会提交到仓库。

Clerk 密钥在 [Clerk Dashboard](https://dashboard.clerk.com) 创建应用后获取。**未设置 `CLERK_SECRET_KEY` 时不启用鉴权**，仅限本地开发使用。

## 启动

```bash
npm start
```

也可以直接用环境变量启动：

```bash
HEXO_SITE_PATH=/path/to/your/hexo-site npm start
```

后台会自动识别站点下的文章目录：

- 优先使用 `<sitePath>/source/_posts`
- 若不存在则使用 `<sitePath>/_posts`

### 部署到服务器

本后台需要运行在有 Hexo 环境的机器上（即站点所在服务器）：

```bash
# 把本目录拷到服务器后
npm install
cp .env.example .env
# 编辑 .env：指向站点目录，并填入 Clerk 密钥
npm start
```

> 生产环境建议用 pm2 / systemd 托管进程，并用 nginx 反向代理 + HTTPS。

## 使用

启动后打开浏览器访问：

```
http://localhost:4001
```

启用 Clerk 鉴权后，首次访问会显示登录页，点击「登录」通过 Clerk 完成登录后进入后台；会话过期时 API 返回 401，前端会自动弹出 Clerk 登录框。

### 快捷键

- `Ctrl/Cmd + S`：保存当前文章

### 一键发布

工具栏的「一键发布」按钮会串行执行 `hexo clean → hexo generate → hexo deploy`，逐步显示输出，任一步失败即中断并显示已产生的日志。发布前若当前文章有未保存更改，会先提示保存。

### Hexo 命令

界面顶部工具栏的「Hexo 命令」下拉框可单独执行：

- `hexo generate`
- `hexo deploy`（执行前有二次确认）
- `hexo clean`

> 注意：命令会在站点根目录下执行。优先使用站点本地安装的 `hexo` 二进制，否则回退到 `npx hexo`（也能找到全局安装的 hexo）。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 当前配置（公开，含 `authEnabled` 与 `clerkPublishableKey`；其余接口在启用 Clerk 后均需鉴权） |
| GET | `/api/posts` | 文章列表（支持 `q`、`tag`、`category`、`page`、`pageSize`） |
| GET | `/api/posts/:slug` | 读取单篇文章 |
| POST | `/api/posts` | 新建文章 |
| PUT | `/api/posts/:slug` | 更新文章 |
| DELETE | `/api/posts/:slug` | 删除文章 |
| POST | `/api/hexo/publish` | 一键发布：串行执行 clean → generate → deploy |
| POST | `/api/hexo/:command` | 执行单个 Hexo 命令 |

鉴权方式：请求头携带 `Authorization: Bearer <Clerk session token>`，后端使用 `@clerk/backend` 的 `verifyToken` 校验。

## 安全提示

- 若部署到公网，**必须**配置 `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` 启用 Clerk 登录。启用后除 `/api/config` 外所有 API 都需要有效的 Clerk 会话。
- 发布/命令接口会以后台进程身份执行 shell 命令，切勿在无鉴权情况下暴露到公网。
