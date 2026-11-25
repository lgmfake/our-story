'use strict';

/**
 * 站点内文章编辑器后端（Vercel Serverless Function）
 *
 * 需要的环境变量（在 Vercel 项目 Settings → Environment Variables 中配置）：
 *   ADMIN_PASSWORD  后台登录密码（自己定，建议 12 位以上）
 *   ADMIN_SECRET    会话签名密钥（随机长字符串，可用 openssl rand -hex 32 生成）
 *   GITHUB_TOKEN    有 lgmfake/our-story 仓库 contents 读写权限的 GitHub Token
 *   GITHUB_REPO     可选，默认 lgmfake/our-story
 *   GITHUB_BRANCH   可选，默认 main
 *
 * 安全约束：只允许读写 content/ 下的 Markdown 文件；所有请求只走 POST；
 * 登录失败 5 次锁定 5 分钟。
 */

const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'lgmfake/our-story';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.ADMIN_SECRET || '';

const COOKIE_NAME = 'fi_admin';
const SESSION_TTL = 7 * 24 * 60 * 60; // 7 天

const loginAttempts = new Map();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function createSessionToken() {
  const payload = { exp: nowSeconds() + SESSION_TTL };
  const data = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [data, mac] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  if (!crypto.timingSafeEqual(given, want)) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > nowSeconds();
  } catch (err) {
    return false;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthenticated(req) {
  return verifySessionToken(parseCookies(req)[COOKIE_NAME]);
}

function passwordMatches(input) {
  if (!PASSWORD || typeof input !== 'string') return false;
  const given = Buffer.from(input);
  const want = Buffer.from(PASSWORD);
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

function send(res, status, payload, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (headers) {
    Object.keys(headers).forEach((key) => res.setHeader(key, headers[key]));
  }
  res.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function assertContentPath(path) {
  if (typeof path !== 'string') throw httpError(400, '缺少文件路径');
  const ok = /^content\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/.test(path);
  if (!ok || path.includes('..')) throw httpError(400, '只能编辑 content/ 目录下的 Markdown 文件');
  return path;
}

async function github(path, options) {
  const opts = options || {};
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method || 'GET',
    headers: Object.assign(
      {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'our-story-admin',
        'Content-Type': 'application/json'
      },
      opts.headers || {}
    ),
    body: opts.body
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = text;
  }
  if (!res.ok) {
    throw httpError(res.status === 404 ? 404 : 502, (data && data.message) || `GitHub API 请求失败（${res.status}）`);
  }
  return data;
}

function parseFrontMatter(text) {
  const result = { title: '', date: '', draft: false };
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return result;
  const block = match[1];
  const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(block);
  if (title) result.title = title[1].trim();
  const date = /^date:\s*["']?(.+?)["']?\s*$/m.exec(block);
  if (date) result.date = date[1].trim();
  const draft = /^draft:\s*(true|false)\s*$/m.exec(block);
  if (draft) result.draft = draft[1] === 'true';
  return result;
}

async function listPosts() {
  const tree = await github(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const blobs = (tree.tree || []).filter(
    (item) => item.type === 'blob' && /^content\/posts\/[^/]+\/index\.md$/.test(item.path)
  );
  const posts = await Promise.all(
    blobs.map(async (item) => {
      const slug = item.path.split('/')[2];
      try {
        const file = await github(`/repos/${REPO}/contents/${encodePath(item.path)}?ref=${BRANCH}`);
        const text = Buffer.from(file.content || '', 'base64').toString('utf8');
        const fm = parseFrontMatter(text);
        return Object.assign({ path: item.path, slug }, fm);
      } catch (err) {
        return { path: item.path, slug, title: slug, date: '', draft: true };
      }
    })
  );
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return posts;
}

async function readFile(path) {
  const file = await github(`/repos/${REPO}/contents/${encodePath(path)}?ref=${BRANCH}`);
  if (!file.content) throw httpError(400, '文件过大，暂不支持在线编辑');
  return {
    sha: file.sha,
    content: Buffer.from(file.content, 'base64').toString('utf8')
  };
}

async function writeFile(path, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const result = await github(`/repos/${REPO}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  return result.content ? result.content.sha : '';
}

function beijingNow() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    iso: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
      date.getUTCHours()
    )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+08:00`
  };
}

function buildArchetype(title, author) {
  const stamp = beijingNow();
  return [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    'subtitle: ""',
    `date: ${stamp.iso}`,
    `lastmod: ${stamp.iso}`,
    'draft: true',
    'author:',
    `  name: "${author}"`,
    'description: ""',
    'keywords: []',
    'comment: true',
    'tags: []',
    'categories: []',
    'hiddenFromHomePage: false',
    'hiddenFromSearch: false',
    'hiddenFromRelated: false',
    'hiddenFromFeed: false',
    '---',
    '',
    '<!--more-->',
    '',
    '',
    ''
  ].join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: '仅支持 POST' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return send(res, 400, { ok: false, error: '请求格式错误' });
    }
  }
  body = body || {};
  const action = body.action;

  if (action === 'session') {
    return send(res, 200, { ok: true, authenticated: isAuthenticated(req) });
  }

  if (!PASSWORD || !SECRET || !TOKEN) {
    return send(res, 503, { ok: false, error: '后台尚未配置环境变量（ADMIN_PASSWORD / ADMIN_SECRET / GITHUB_TOKEN）' });
  }

  if (action === 'login') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const record = loginAttempts.get(ip);
    if (record && record.until > Date.now()) {
      return send(res, 429, { ok: false, error: '尝试次数过多，请 5 分钟后再试' });
    }
    if (!passwordMatches(body.password)) {
      const next = record && record.until < Date.now() ? { count: 0, until: 0 } : record || { count: 0, until: 0 };
      next.count += 1;
      if (next.count >= 5) {
        next.until = Date.now() + 5 * 60 * 1000;
        next.count = 0;
      }
      loginAttempts.set(ip, next);
      return send(res, 401, { ok: false, error: '密码不正确' });
    }
    loginAttempts.delete(ip);
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=${createSessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure}`
    });
  }

  if (action === 'logout') {
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    });
  }

  if (!isAuthenticated(req)) {
    return send(res, 401, { ok: false, error: '登录已过期，请重新登录' });
  }

  try {
    if (action === 'list') {
      return send(res, 200, { ok: true, posts: await listPosts() });
    }

    if (action === 'get') {
      const path = assertContentPath(body.path);
      const file = await readFile(path);
      return send(res, 200, { ok: true, path, sha: file.sha, content: file.content });
    }

    if (action === 'save') {
      const path = assertContentPath(body.path);
      if (typeof body.content !== 'string' || body.content.length === 0) {
        throw httpError(400, '内容为空');
      }
      if (body.content.length > 512 * 1024) {
        throw httpError(413, '文章内容过大（超过 512KB）');
      }
      const sha = await writeFile(path, body.content, body.sha, body.message || `编辑文章：${path}`);
      return send(res, 200, { ok: true, sha });
    }

    if (action === 'create') {
      const slug = String(body.slug || '').trim();
      const title = String(body.title || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
        throw httpError(400, '短名只能包含小写字母、数字和短横线');
      }
      if (!title) throw httpError(400, '请填写标题');
      const path = `content/posts/${slug}/index.md`;
      const exists = await readFile(path).then(
        () => true,
        (err) => {
          if (err.status === 404) return false;
          throw err;
        }
      );
      if (exists) throw httpError(409, '同名文章已存在，请换一个短名');
      const content = buildArchetype(title, String(body.author || '猫猫').trim() || '猫猫');
      const sha = await writeFile(path, content, null, `新建文章：${title}`);
      return send(res, 200, { ok: true, path, sha, content });
    }

    return send(res, 400, { ok: false, error: '未知操作' });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return send(res, status, { ok: false, error: err.message || '服务器错误' });
  }
};
