// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// The guide inside the app (menu › Guide, http://localhost:4263/guide): docs/REHBER.md or docs/GUIDE.md, in the
// language Handry speaks. The same files show on GitHub. A small Markdown reader, for what these two files use.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { lang } from './i18n.js';
import { APP_NAME } from './brand.js';

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]+)\]\((#[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) {
      const level = heading[1].length, id = slug(heading[2]);
      if (level === 2) toc.push(`<a href="#${id}">${inline(heading[2])}</a>`);
      out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      for (; i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^[-*] /.test(lines[i])); i++) items.push(lines[i].replace(/^([-*]|\d+\.) /, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (line.startsWith('> ')) {
      const quote = [];
      for (; i < lines.length && lines[i].startsWith('> '); i++) quote.push(lines[i].slice(2));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,3} |```|\||[-*] |\d+\. |> |---+$)/.test(lines[i]); i++) para.push(lines[i]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), toc };
}

export function guidePage() {
  const language = lang();
  const file = path.join(ROOT, 'docs', language === 'en' ? 'GUIDE.md' : 'REHBER.md');
  let md;
  try { md = fs.readFileSync(file, 'utf-8'); } catch { md = `# ${APP_NAME}\n\nhttps://github.com/purplefox21/handry`; }
  const { html, toc } = markdownToHtml(md);
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${APP_NAME} · ${language === 'en' ? 'Guide' : 'Rehber'}</title>
<style>
:root { --bg: #fbfbfd; --text: #1d1d1f; --soft: #6e6e73; --line: rgba(0,0,0,.12); --card: rgba(0,0,0,.04); }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --text: #f5f5f7; --soft: #a1a1a6; --line: rgba(255,255,255,.14); --card: rgba(255,255,255,.06); } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
.page { display: grid; grid-template-columns: 240px minmax(0, 720px); gap: 48px; justify-content: center; padding: 48px 24px 96px; }
nav { position: sticky; top: 32px; align-self: start; max-height: calc(100vh - 64px); overflow: auto; font-size: 13px; }
nav a { display: block; padding: 4px 0; color: var(--soft); text-decoration: none; }
nav a:hover { color: var(--text); }
h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: -.02em; line-height: 1.15; }
h2 { margin: 48px 0 12px; padding-top: 24px; font-size: 22px; letter-spacing: -.01em; border-top: .5px solid var(--line); }
h3 { margin: 28px 0 8px; font-size: 16px; }
p, ul, ol { margin: 0 0 12px; }
li { margin-bottom: 5px; }
a { color: inherit; }
code { padding: 1px 5px; font: 13px ui-monospace, Menlo, monospace; background: var(--card); border-radius: 5px; }
pre { padding: 12px 14px; overflow-x: auto; background: var(--card); border-radius: 10px; }
pre code { padding: 0; background: none; }
blockquote { margin: 0 0 12px; padding: 10px 14px; color: var(--soft); background: var(--card); border-radius: 10px; }
.table { overflow-x: auto; margin: 0 0 14px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 10px; text-align: left; vertical-align: top; border-bottom: .5px solid var(--line); }
th { font-weight: 600; color: var(--soft); }
hr { border: 0; border-top: .5px solid var(--line); margin: 32px 0; }
@media (max-width: 860px) { .page { grid-template-columns: minmax(0, 1fr); padding: 24px 16px 64px; } nav { display: none; } }
</style></head>
<body><div class="page"><nav>${toc.join('')}</nav><main>${html}</main></div></body></html>`;
}
