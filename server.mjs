// TheoAgent 图文设计器 · 独立本地服务
// 用法：node server.mjs [端口]（默认 8090）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderArtboards } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TPL = path.join(ROOT, 'template.json');
const SAMPLE = path.join(ROOT, 'sample.json');
const OUTPUT = path.join(ROOT, 'output');
const TPLDIR = path.join(ROOT, 'templates');
const PORT = Number(process.argv[2] || 8090);
const HOST = '127.0.0.1';
const sanitizeTplName = (n) => String(n || '').replace(/[^\w\u4e00-\u9fa5.\-]+/g, '_').slice(0, 60);

const FONTS = { 'Smiley Sans': 'SmileySans.ttf', 'Noto Serif': 'NotoSerif-VF.ttf', 'Noto Sans': 'NotoSans-VF.ttf', 'Noto Sans SC': 'NotoSansSC-VF.ttf' };

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); req.on('error', reject); });
const readRaw = (req) => new Promise((resolve, reject) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
const safeJoin = (base, p) => { const root = path.resolve(base); const abs = path.resolve(root, p); return abs === root || abs.startsWith(root + path.sep) ? abs : null; };

function sendFile(res, file, type, cache = 'no-cache') {
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
}

function openInBrowser(url) {
  const cmd = process.platform === 'win32' ? `cmd /c start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  spawn(cmd, { shell: true, stdio: 'ignore' });
}

export function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') return sendFile(res, path.join(ROOT, 'designer.html'), 'text/html; charset=utf-8');
      if (url.pathname === '/api/template' && req.method === 'GET') return json(res, 200, readJson(TPL));
      if (url.pathname === '/api/template' && req.method === 'POST') {
        fs.writeFileSync(TPL, JSON.stringify(JSON.parse(await readBody(req)), null, 2) + '\n', 'utf8');
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/sample') {
        if (req.method === 'POST') { fs.writeFileSync(SAMPLE, JSON.stringify(JSON.parse(await readBody(req)), null, 2) + '\n', 'utf8'); return json(res, 200, { ok: true }); }
        return json(res, 200, readJson(SAMPLE));
      }
      if (url.pathname === '/api/fonts') return json(res, 200, FONTS);
      if (url.pathname.startsWith('/fonts/')) {
        const name = decodeURIComponent(url.pathname.slice('/fonts/'.length));
        const f = safeJoin(path.join(ROOT, 'fonts'), name);
        if (!f) { res.writeHead(403).end('forbidden'); return; }
        return sendFile(res, f, 'font/ttf');
      }
      if (url.pathname.startsWith('/files/')) {
        const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
        const f = safeJoin(ROOT, rel);
        if (!f || !fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
        const mt = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(f).toLowerCase()] || 'application/octet-stream';
        return sendFile(res, f, mt);
      }
      if (url.pathname === '/api/upload' && req.method === 'POST') {
        const raw = String(url.searchParams.get('name') || 'upload.png');
        const base = path.basename(raw);
        const ext = (path.extname(base) || '.png').toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) { res.writeHead(400).end('bad ext'); return; }
        const buf = await readRaw(req);
        if (!buf.length) { res.writeHead(400).end('empty'); return; }
        fs.mkdirSync(path.join(ROOT, 'uploads'), { recursive: true });
        const stem = (base.replace(/\.[^.]+$/, '') || 'img').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
        const fname = `${Date.now()}-${stem}${ext}`;
        fs.writeFileSync(path.join(ROOT, 'uploads', fname), buf);
        return json(res, 200, { ok: true, path: 'uploads/' + fname });
      }
      if (url.pathname === '/api/render' && req.method === 'POST') {
        const { template, content, scale } = JSON.parse(await readBody(req));
        const results = await renderArtboards(template, content, { outDir: OUTPUT, scale: Math.max(1, Math.min(3, Number(scale) || 1)) });
        return json(res, 200, { ok: true, files: results.map((r) => ({ id: r.id, url: `/preview/${r.id}.png`, width: r.width, height: r.height })) });
      }
      if (url.pathname === '/api/templates' && req.method === 'GET') {
        const list = fs.existsSync(TPLDIR) ? fs.readdirSync(TPLDIR).filter((f) => f.endsWith('.json')).map((f) => ({ name: f.replace(/\.json$/, ''), modified: fs.statSync(path.join(TPLDIR, f)).mtimeMs })) : [];
        return json(res, 200, { ok: true, list });
      }
      if (url.pathname === '/api/templates' && req.method === 'POST') {
        const name = sanitizeTplName(url.searchParams.get('name'));
        if (!name) return json(res, 400, { ok: false, error: 'bad name' });
        const body = JSON.parse(await readBody(req));
        fs.mkdirSync(TPLDIR, { recursive: true });
        fs.writeFileSync(path.join(TPLDIR, name + '.json'), JSON.stringify(body, null, 2) + '\n', 'utf8');
        return json(res, 200, { ok: true, name });
      }
      if (url.pathname === '/api/templates/load' && req.method === 'GET') {
        const name = sanitizeTplName(url.searchParams.get('name'));
        const f = name ? path.join(TPLDIR, name + '.json') : '';
        if (!f || !fs.existsSync(f)) return json(res, 404, { ok: false, error: 'not found' });
        return json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (url.pathname === '/api/templates' && req.method === 'DELETE') {
        const name = sanitizeTplName(url.searchParams.get('name'));
        const f = name ? path.join(TPLDIR, name + '.json') : '';
        if (f && fs.existsSync(f)) fs.unlinkSync(f);
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/preview/')) {
        const name = decodeURIComponent(url.pathname.slice('/preview/'.length));
        const f = safeJoin(OUTPUT, name);
        if (!f) { res.writeHead(404).end('not found'); return; }
        return sendFile(res, f, 'image/png');
      }
      res.writeHead(404).end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  server.listen(port, HOST, () => {
    const u = `http://${HOST}:${port}`;
    console.log(`TheoAgent 图文设计器 → ${u}`);
    console.log('（预览不依赖 Chrome；导出 PNG 需要本机已装 Chrome 或 Edge）');
    openInBrowser(u);
  });
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startServer();
