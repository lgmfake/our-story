# 项目维护手册（新 AI 接手先读这里）

这是一个 Hugo 静态情侣博客，标题「我们的故事」，已经上线运行。

---

## 1. 一句话概括

- 网站：**https://cxxlgm.com**（访问会自动 308 跳转到 **https://www.cxxlgm.com**）
- 技术栈：Hugo 静态站 + FixIt 主题（git 子模块）
- 代码托管：GitHub 公开仓库 **lgmfake/our-story**（main 分支）
- 部署平台：Vercel（push 后自动部署）
- 域名：cxxlgm.com（阿里云注册，已实名认证）

---

## 2. 所有关键路径

| 内容 | 路径 |
|------|------|
| 本地项目根目录 | `D:\blog\myloverblog` |
| 站点配置 | `D:\blog\myloverblog\hugo.toml` |
| 文章目录 | `D:\blog\myloverblog\content\posts\`（每篇一个子文件夹） |
| 文章模板 | `D:\blog\myloverblog\archetypes\posts.md` |
| Vercel 构建配置 | `D:\blog\myloverblog\vercel.json` |
| 主题（子模块） | `D:\blog\myloverblog\themes\FixIt` |
| 构建产物（勿提交） | `D:\blog\myloverblog\public\` |
| 用户写文章的临时文件 | `C:\Users\lenovo\Desktop\写文章模板.txt` |

---

## 3. 技术细节

- **Hugo**：v0.166.0 extended，winget 安装，可执行文件在
  `C:\Users\lenovo\AppData\Local\Microsoft\WinGet\Packages\Hugo.Hugo.Extended_*\hugo.exe`
- **主题**：FixIt，git 子模块，url = `https://github.com/hugo-fixit/FixIt.git`
- **GitHub 远程**：`https://github.com/lgmfake/our-story.git`，分支 `main`，仓库已设为 **public**
- **默认作者署名**：`猫猫`
- **站点标题**：`我们的故事`

---

## 4. 部署链路

```
GitHub (lgmfake/our-story, main 分支)
        │  git push
        ▼
Vercel 自动部署（读取 vercel.json）
        │
        ▼
https://cxxlgm.com  → 308 跳转 → https://www.cxxlgm.com
```

**阿里云 DNS（云解析）两条记录：**
- `@` 的 A 记录 → `76.76.21.21`
- `www` 的 CNAME 记录 → `cname.vercel-dns.com`

**vercel.json 内容（关键）：**
```json
{
  "framework": "hugo",
  "installCommand": "git submodule update --init --recursive",
  "buildCommand": "hugo --gc --minify",
  "outputDirectory": "public"
}
```

---

## 5. 写文章 & 发布流程（当前方案）

1. 用户把内容写进桌面 `写文章模板.txt`（三块：`【标题】` `【作者】` `【正文】`），或直接发消息给 AI
2. 用户说「写好了」
3. AI 读 txt → 在 `content/posts/<slug>/index.md` 生成文章（带 front matter）
4. 本地构建验证：`hugo --gc --minify`
5. 提交推送：`git add content && git commit -m "..." && git push origin main`
6. Vercel 自动部署上线

**front matter 格式**（见 `archetypes/posts.md`）：
```yaml
---
title: "文章标题"
date: 2026-09-21
draft: false
author:
  name: "猫猫"
tags: []
categories: []
---

正文……
```

---

## 6. 常见维护操作

| 想做什么 | 怎么做 |
|---------|--------|
| 改默认作者名 | 改 `hugo.toml` 的 `[params.author].name` + `archetypes/posts.md` 的 `name` |
| 改站点标题/副标题 | 改 `hugo.toml` 的 `title` / `[params.home.profile]` |
| 写新文章 | 用第 5 节流程 |
| 删文章 | 删除 `content/posts/<对应文件夹>`，然后 push |
| 在线写/改文章（不用 GitHub） | 打开 `https://www.cxxlgm.com/admin/`，输入后台密码 |
| 本地预览 | `hugo server -D`，浏览器打开 http://localhost:1313 |
| 本地构建 | `hugo --gc --minify` |
| 用模板生成新文章 | `hugo new posts/<文件名>.md` |

---

## 7. 关键坑（务必注意，踩过很多次）

1. **FixIt 是 git 子模块**：Vercel 不会自动拉子模块，必须在 `vercel.json` 里配
   `installCommand: "git submodule update --init --recursive"`（已配好，别删）。
   本地若主题目录空了，跑 `git submodule update --init --recursive` 恢复。

2. **baseURL 必须是 `https://cxxlgm.com/`**（`hugo.toml` 里），不能是 example.com，否则所有链接都错。

3. **GitHub 仓库必须保持 public**：如果改回 private，Vercel 免费版（Hobby）会因
   "私有仓库协作限制"要求升级 Pro，部署会被锁死（报错 "commit author did not have
   contributing access" / "upgrade to Pro to add team members"）。

4. **阿里云域名要实名认证**才能解析（已完成）。

5. **国内网络访问 GitHub/Vercel 不稳定**：
   - `git push` 可能报 `Failed to connect to github.com port 443` 或
     `remote end hung up`，重试即可，或用手机热点/代理。
   - Vercel 有时不自动部署，需去 Vercel 后台 Deployments 页手动点 **Redeploy**。

6. **`draft: true` 是草稿**，不会发布，必须改成 `false`。

7. **域名跳转**：www 是主域名，裸域名 cxxlgm.com 会 308 跳转到 www 版本。

---

## 8. GitHub 认证（本机）

- 本机 Git 用 Windows **Git Credential Manager**（`credential.helper = manager`）存凭据，
  `git push/pull` 自动用，无需输密码。
- 需要调 GitHub API（如改仓库设置）时，可用
  `printf "protocol=https\nhost=github.com\n\n" | git credential fill` 取 token（**不要打印 token 内容**）。
- `gh` CLI **未登录**，要用得先 `gh auth login`。

---

## 9. 给新接手 AI 的起手步骤

1. 读本文件（`CLAUDE.md`）
2. 看关键文件：`hugo.toml`、`vercel.json`、`content/posts/` 目录结构
3. 跑一次 `cd /d/blog/myloverblog && hugo --gc --minify` 确认能构建
4. 看 git 状态：`git status` 和 `git log --oneline -5`
5. 要发文章时：读桌面 `写文章模板.txt`，或直接问用户要内容

---

## 10. 在线编辑后台（/admin）

给两个人共用，**不需要 GitHub 账号**，只需一个共享密码。

| 内容 | 位置 |
|------|------|
| 后台页面 | `https://www.cxxlgm.com/admin/`（已加 noindex） |
| 前端 | `static/admin/index.html`（单文件，直接编辑 Markdown 原文） |
| 后端 | `api/admin.js`（Vercel Serverless Function，根目录 `api/` 会被自动识别） |

保存流程：后台调 GitHub API 提交到 `lgmfake/our-story` 的 `main` → Vercel 自动重建上线（约 1 分钟）。

**Vercel 环境变量**（项目 Settings → Environment Variables，Production 和 Preview 都要配）：

| 变量 | 说明 |
|------|------|
| `ADMIN_PASSWORD` | 后台登录密码（自己定，建议 12 位以上） |
| `ADMIN_SECRET` | 会话签名密钥，随机长字符串（如 `openssl rand -hex 32`） |
| `GITHUB_TOKEN` | 对仓库有 Contents 读写权限的 Token（Fine-grained PAT） |

**安全设计**：密码错误 5 次锁定 5 分钟；会话 Cookie HttpOnly + HMAC 签名，7 天过期；
接口只允许读写 `content/` 下的 `.md`；Token 只存在服务端，不会下发到浏览器。
改密码只需改 `ADMIN_PASSWORD` 后重新部署。

