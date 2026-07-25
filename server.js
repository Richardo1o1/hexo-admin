const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const matter = require('gray-matter');
const { marked } = require('marked');
const { verifyToken } = require('@clerk/backend');
require('dotenv').config();

const execAsync = util.promisify(exec);
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// All configuration comes from environment variables (optionally via a local .env file).
const PORT = process.env.PORT || 4001;
const HEXO_SITE_PATH = process.env.HEXO_SITE_PATH;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

function resolveSitePath() {
  if (HEXO_SITE_PATH) {
    const resolved = path.resolve(HEXO_SITE_PATH);
    return { sitePath: resolved, source: 'HEXO_SITE_PATH env' };
  }
  // Fallback: the current directory may itself contain _posts (development convenience).
  return { sitePath: __dirname, source: 'current directory fallback' };
}

function resolvePostsDir(sitePath) {
  const standard = path.join(sitePath, 'source', '_posts');
  const root = path.join(sitePath, '_posts');
  // Auto-detect based on existing directory.
  try {
    if (require('fs').existsSync(standard)) return standard;
    if (require('fs').existsSync(root)) return root;
  } catch (e) {
    // ignore
  }
  return standard;
}

const { sitePath, source } = resolveSitePath();
const postsDir = resolvePostsDir(sitePath);

function requireSitePath(req, res, next) {
  if (!HEXO_SITE_PATH) {
    return res.status(400).json({
      error: 'HEXO_SITE_PATH is not configured',
      hint: 'Start with HEXO_SITE_PATH=/path/to/hexo-site npm start (or set it in .env)'
    });
  }
  next();
}

// Clerk auth: verify the session token sent as a Bearer token by the frontend.
// When CLERK_SECRET_KEY is not set, auth is disabled (local development only).
async function requireAuth(req, res, next) {
  if (!CLERK_SECRET_KEY) return next();
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function toSlug(filename) {
  return filename.replace(/\.md$/i, '');
}

function toFilename(slug) {
  if (/\.md$/i.test(slug)) return slug;
  return slug + '.md';
}

function sanitizeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '-').replace(/-+/g, '-');
}

function arrayify(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  return [value];
}

function localDateTime(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Post summary cache: re-read file contents only when mtime changes.
// stat() on ~400 files is a few ms; reading + parsing them is the expensive part.
const postsCache = { mtimes: new Map(), posts: new Map() };

async function loadPostSummaries() {
  const files = (await fs.readdir(postsDir)).filter(f => f.endsWith('.md'));
  const seen = new Set(files);

  for (const key of [...postsCache.mtimes.keys()]) {
    if (!seen.has(key)) {
      postsCache.mtimes.delete(key);
      postsCache.posts.delete(key);
    }
  }

  for (const file of files) {
    const filePath = path.join(postsDir, file);
    try {
      const stat = await fs.stat(filePath);
      if (postsCache.mtimes.get(file) === stat.mtimeMs) continue;
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);
      postsCache.mtimes.set(file, stat.mtimeMs);
      postsCache.posts.set(file, {
        slug: toSlug(file),
        filename: file,
        title: parsed.data.title || toSlug(file),
        date: parsed.data.date ? new Date(parsed.data.date).toISOString() : null,
        tags: arrayify(parsed.data.tags),
        categories: arrayify(parsed.data.categories),
        excerpt: parsed.content.slice(0, 200).replace(/[#*`\[\]!()]/g, '').trim()
      });
    } catch (e) {
      // Skip unreadable files silently.
    }
  }

  return [...postsCache.posts.values()];
}

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json({
    sitePath,
    postsDir,
    source,
    authEnabled: Boolean(CLERK_SECRET_KEY),
    clerkPublishableKey: CLERK_PUBLISHABLE_KEY || null,
    commands: ['generate', 'deploy', 'clean', 'server', 'new']
  });
});

// All API routes below this line require a valid Clerk session when
// CLERK_SECRET_KEY is set. (/api/config above stays public so the UI can
// discover whether auth is enabled and get the publishable key.)
app.use('/api', requireAuth);

// GET /api/posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await loadPostSummaries();

    posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const q = (req.query.q || '').toString().toLowerCase();
    const tag = (req.query.tag || '').toString();
    const category = (req.query.category || '').toString();

    let filtered = posts;
    if (q) {
      filtered = filtered.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.slug || '').toLowerCase().includes(q)
      );
    }
    if (tag) {
      filtered = filtered.filter(p => p.tags.includes(tag));
    }
    if (category) {
      filtered = filtered.filter(p => p.categories.includes(category));
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize, 10) || 20));
    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    // Aggregate available tags and categories for filters.
    const allTags = [...new Set(posts.flatMap(p => p.tags))].sort();
    const allCategories = [...new Set(posts.flatMap(p => p.categories))].sort();

    res.json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      tags: allTags,
      categories: allCategories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/posts/:slug
app.get('/api/posts/:slug', async (req, res) => {
  try {
    const filePath = path.join(postsDir, toFilename(req.params.slug));
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    res.json({
      slug: req.params.slug,
      filename: toFilename(req.params.slug),
      frontMatter: parsed.data,
      content: parsed.content,
      html: marked(parsed.content)
    });
  } catch (err) {
    res.status(404).json({ error: 'Post not found', detail: err.message });
  }
});

// PUT /api/posts/:slug
app.put('/api/posts/:slug', async (req, res) => {
  try {
    const { title, date, tags, categories, content } = req.body;
    const filename = toFilename(req.params.slug);
    const filePath = path.join(postsDir, filename);

    // Preserve existing front matter where fields are not provided.
    let existing = {};
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      existing = matter(raw).data;
    } catch (e) {
      // File may not exist yet; that's fine.
    }

    const frontMatter = {
      ...existing,
      ...(title !== undefined && { title }),
      ...(date !== undefined && { date }),
      ...(tags !== undefined && { tags: arrayify(tags) }),
      ...(categories !== undefined && { categories: arrayify(categories) })
    };

    // If title changed, consider renaming the file to match (optional, keeps slug stable here).
    const newContent = matter.stringify(content || '', frontMatter);
    await fs.writeFile(filePath, newContent, 'utf-8');

    res.json({ success: true, slug: req.params.slug, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts
app.post('/api/posts', async (req, res) => {
  try {
    let { slug, title, content = '' } = req.body;
    title = title || 'Untitled';
    slug = sanitizeSlug(slug || title);
    if (!slug) slug = 'untitled';
    const filename = toFilename(slug);
    const filePath = path.join(postsDir, filename);

    // Avoid overwriting existing file.
    try {
      await fs.access(filePath);
      return res.status(409).json({ error: 'Post already exists', filename });
    } catch (e) {
      // expected
    }

    const frontMatter = {
      title,
      date: localDateTime(),
      tags: [],
      categories: []
    };
    const newContent = matter.stringify(content, frontMatter);
    await fs.writeFile(filePath, newContent, 'utf-8');

    res.status(201).json({ success: true, slug, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/posts/:slug
app.delete('/api/posts/:slug', async (req, res) => {
  try {
    const filePath = path.join(postsDir, toFilename(req.params.slug));
    await fs.unlink(filePath);
    res.json({ success: true, slug: req.params.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function hexoBin() {
  // Prefer the site's local hexo binary; fall back to npx (which also finds global installs).
  const localHexo = path.join(sitePath, 'node_modules', '.bin', 'hexo');
  return require('fs').existsSync(localHexo) ? localHexo : 'npx hexo';
}

function runHexo(args) {
  return execAsync(`${hexoBin()} ${args}`, {
    cwd: sitePath,
    timeout: 600000, // 10 minutes
    maxBuffer: 10 * 1024 * 1024
  });
}

// POST /api/hexo/publish — one-click publish: hexo clean → generate → deploy.
app.post('/api/hexo/publish', requireSitePath, async (req, res) => {
  const steps = ['clean', 'generate', 'deploy'];
  let output = '';

  for (const step of steps) {
    output += `$ hexo ${step}\n`;
    try {
      const { stdout, stderr } = await runHexo(step);
      if (stdout) output += stdout.trim() + '\n';
      if (stderr) output += stderr.trim() + '\n';
      output += `[完成] hexo ${step}\n\n`;
    } catch (err) {
      if (err.stdout) output += err.stdout.trim() + '\n';
      if (err.stderr) output += err.stderr.trim() + '\n';
      output += `[失败] hexo ${step}: ${err.message}\n`;
      return res.status(500).json({ success: false, step, output, error: err.message });
    }
  }

  res.json({ success: true, output });
});

// POST /api/hexo/:command
app.post('/api/hexo/:command', requireSitePath, async (req, res) => {
  const command = req.params.command;
  const allowed = ['generate', 'deploy', 'clean', 'server', 'new'];
  if (!allowed.includes(command)) {
    return res.status(400).json({ error: `Unknown command: ${command}` });
  }

  // For safety, do not allow long-running server command through this endpoint.
  if (command === 'server') {
    return res.status(400).json({ error: 'Use "hexo server" from terminal; this endpoint is for build/deploy only.' });
  }

  try {
    const { stdout, stderr } = await runHexo(command);
    res.json({ success: true, command: `hexo ${command}`, stdout, stderr });
  } catch (err) {
    res.status(500).json({
      success: false,
      command: `hexo ${command}`,
      error: err.message,
      stdout: err.stdout,
      stderr: err.stderr
    });
  }
});

// Health check.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sitePath, postsDir });
});

app.listen(PORT, () => {
  console.log(`Hexo Admin running at http://localhost:${PORT}`);
  console.log(`  Hexo site path: ${sitePath} (${source})`);
  console.log(`  Posts directory: ${postsDir}`);
  if (CLERK_SECRET_KEY) {
    console.log('  Authentication: Clerk (enabled)');
  } else {
    console.log('  Authentication: disabled (set CLERK_SECRET_KEY to enable Clerk login)');
  }
});
