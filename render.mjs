// 自包含模板渲染器：模板 JSON + 内容 → HTML → 无头 Chrome 截图 PNG
// 用法：node render.mjs [template.json] [sample.json] [outputDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const FACE = {
  'Smiley Sans': ['Smiley', 'fonts/SmileySans.ttf', '400'],
  'Noto Serif': ['NotoSerif', 'fonts/NotoSerif-VF.ttf', '100 900'],
  'Noto Sans': ['NotoSans', 'fonts/NotoSans-VF.ttf', '100 900'],
  'Noto Sans SC': ['NotoSC', 'fonts/NotoSansSC-VF.ttf', '100 900'],
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of CANDIDATES[process.platform] || []) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Chrome/Edge。导出 PNG 需要本机已装 Chrome 或 Edge；或设置环境变量 CHROME_PATH。');
}

async function openBrowser() {
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-gpu'],
  });
}

function fontCss(names) {
  return names
    .filter((n) => FACE[n])
    .map((n) => {
      const [fam, file, weight] = FACE[n];
      return `@font-face{font-family:'${fam}';src:url("${pathToFileURL(path.join(ROOT, file)).href}") format('truetype');font-weight:${weight};font-display:block;}`;
    })
    .join('\n');
}

/** 图片路径解析：dataURL / http 原样；相对路径按本文件夹解析；绝对路径转 file:// */
function resolveFile(p) {
  if (!p) return '';
  if (/^data:/.test(p) || /^https?:/.test(p)) return p;
  if (path.isAbsolute(p)) return pathToFileURL(p).href;
  return pathToFileURL(path.join(ROOT, p)).href;
}

function substitute(s, content) {
  return String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (content[k] !== undefined ? content[k] : m));
}

function elementHtml(el, content) {
  const px = (v) => `${v}px`;
  const pos = `position:absolute;left:${px(el.x)};top:${px(el.y)};transform:rotate(${el.rotate || 0}deg);`;
  if (el.type === 'image') {
    const src = resolveFile(substitute(el.src, content));
    return `<img id="${esc(el.id)}" style="${pos}width:${px(el.w)};height:${px(el.h)};object-fit:${el.fit || 'cover'};border-radius:${px(el.radius || 0)};display:block;" src="${esc(src)}" alt="">`;
  }
  if (el.type === 'rect') {
    return `<div id="${esc(el.id)}" style="${pos}width:${px(el.w)};height:${px(el.h)};background:${el.color || 'transparent'};border-radius:${px(el.radius || 0)};border:${el.border || 'none'};"></div>`;
  }
  const text = esc(substitute(el.content, content));
  const fam = FACE[el.font] ? FACE[el.font][0] : 'NotoSC';
  return `<div id="${esc(el.id)}" style="${pos}width:${px(el.w)};height:${px(el.h)};font-family:'${fam}',sans-serif;font-size:${px(el.size || 28)};color:${el.color || '#1F1F1F'};text-align:${el.align || 'left'};line-height:${el.lineHeight || 1.4};font-weight:${el.bold ? '600' : '400'};white-space:pre-line;overflow:hidden;">${text}</div>`;
}

function buildHtml(ab, content, faceCss) {
  const els = ab.elements.filter((el) => el.visible !== false).map((el) => elementHtml(el, content)).join('\n');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${faceCss}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:${ab.width}px;height:${ab.height}px;overflow:hidden;}
body{background:${ab.background || '#fff'};-webkit-font-smoothing:antialiased;}
</style></head><body>${els}</body></html>`;
}

/** 把模板的每块画布渲成 PNG。content = 扁平占位符映射。 */
export async function renderArtboards(template, content, { outDir, scale = 2 } = {}) {
  const pages = template.pages || template.artboards || [];
  const fontsUsed = [...new Set(pages.flatMap((a) => a.elements.map((e) => e.font)))];
  const faceCss = fontCss(fontsUsed);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await openBrowser();
  try {
    const page = await browser.newPage();
    const results = [];
    for (const ab of pages) {
      const html = buildHtml(ab, content, faceCss);
      const htmlPath = path.join(outDir, `${ab.id}.html`);
      const pngPath = path.join(outDir, `${ab.id}.png`);
      fs.writeFileSync(htmlPath, html, 'utf8');
      await page.setViewport({ width: ab.width, height: ab.height, deviceScaleFactor: scale });
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      });
      await page.screenshot({ path: pngPath });
      results.push({ id: ab.id, name: ab.name, width: ab.width, height: ab.height, png: pngPath });
      console.log(`  ✓ ${ab.id}.png  ${ab.width}×${ab.height}`);
    }
    return results;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [tp, cp, out] = process.argv.slice(2);
  const tpl = JSON.parse(fs.readFileSync(tp || path.join(ROOT, 'template.json'), 'utf8'));
  const c = JSON.parse(fs.readFileSync(cp || path.join(ROOT, 'sample.json'), 'utf8'));
  await renderArtboards(tpl, c, { outDir: out || path.join(ROOT, 'output') });
}
