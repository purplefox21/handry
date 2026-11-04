// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// First launch for someone without Claude: simple commands aren't blocked, a bigger task says what to do, the
// card's steps work with a fake `claude` (nothing is downloaded, signed in or opened), and the guide page renders
// in both languages. Everything runs in a child with a throwaway home folder and Handry folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-setup-'));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` (${extra})` : ''}`); };

function inChild(code, { lang = 'tr' } = {}) {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT, encoding: 'utf-8', timeout: 60000,
    env: { PATH: '/usr/bin:/bin', HOME: home, JEVIS_HOME: path.join(home, '.jevis'), JEVIS_LANG: lang, JEVIS_JEV: 'off', JEVIS_SETUP_DRY: '1' }
  });
  try { return JSON.parse(out.stdout.trim().split('\n').pop()); } catch { return { failed: (out.stderr || out.stdout).slice(-400) }; }
}
const STATE = `const { setupState } = await import('./core/setup.js'); console.log(JSON.stringify(await setupState()));`;

let s = inChild(STATE);
check('without Claude the card says so', s.claude?.installed === false && s.claude?.loggedIn === false, s.failed || '');
check('Chrome is checked', typeof s.chrome === 'boolean');

const run = inChild(`const { runCommand } = await import('./core/runner.js');
const out = await runCommand({ text: 'şu formu baştan sona doldur ve kaydet', source: 'test', fast: false, onEvent: () => {} });
console.log(JSON.stringify({ text: out.text, noBrain: out.noBrain }));`);
check('a bigger task without Claude says what to do', run.noBrain === true && /Claude'u Kur/.test(run.text || ''), run.failed || '');
const runEn = inChild(`const { runCommand } = await import('./core/runner.js');
const out = await runCommand({ text: 'fill in this whole form and save it', source: 'test', fast: false, onEvent: () => {} });
console.log(JSON.stringify({ text: out.text }));`, { lang: 'en' });
check('in English too', /Install Claude/.test(runEn.text || ''), runEn.failed || '');

// A fake claude in ~/.local/bin, where the installer puts the real one
const bin = path.join(home, '.local', 'bin');
fs.mkdirSync(bin, { recursive: true });
const flag = path.join(home, 'signed-in');
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nif [ -f ${JSON.stringify(flag)} ]; then echo '{"loggedIn":true}'; else echo '{"loggedIn":false}'; fi\n`, { mode: 0o755 });

s = inChild(STATE);
check('Claude found where its installer puts it', s.claude?.installed === true, s.failed || '');
check('not signed in yet', s.claude?.loggedIn === false);

const login = inChild(`const { loginClaude } = await import('./core/setup.js'); console.log(JSON.stringify(loginClaude()));`);
const script = login.file ? fs.readFileSync(login.file, 'utf-8') : '';
check('signing in is a window that runs Claude\'s own login', login.opened === true && script.includes('auth login') && (fs.statSync(login.file).mode & 0o111) !== 0, login.failed || '');

fs.writeFileSync(flag, '');
s = inChild(STATE);
check('signed in: the card sees it', s.claude?.loggedIn === true);

inChild(`const { dismissSetup } = await import('./core/setup.js'); console.log(JSON.stringify(dismissSetup()));`);
s = inChild(STATE);
check('"Skip for now" is remembered', s.dismissed === true);

const installer = fs.readFileSync(path.join(ROOT, 'core', 'setup.js'), 'utf-8');
check('the installer is Claude\'s own, over https', /https:\/\/claude\.ai\/install\.sh/.test(installer));

for (const [lang, title, must] of [['tr', 'Rehber', ['Kurulum', 'Sorun giderme', 'Kaydı Sıfırla', 'Acil durdurma']], ['en', 'Guide', ['Install', 'Troubleshooting', 'Reset Entry', 'Emergency stop']]]) {
  const page = inChild(`const { guidePage } = await import('./core/guide.js'); console.log(JSON.stringify({ html: guidePage() }));`, { lang });
  const html = page.html || '';
  check(`the ${lang} guide renders`, html.includes(`· ${title}</title>`) && must.every(w => html.includes(w)) && !/\*\*|^#{1,3} /m.test(html.replace(/<style>[\s\S]*<\/style>/, '')), page.failed || '');
  check(`the ${lang} guide has tables, code and a contents list`, /<table>/.test(html) && /<pre>/.test(html) && /<nav><a href="#/.test(html));
}
// Connecting to Claude: what people paste has to be valid (package-e2e checks that these paths exist in the app).
const MCP_NODE = '/Applications/Handry.app/Contents/Helpers/node';
const MCP_SERVER = '/Applications/Handry.app/Contents/Resources/handry/mcp/server.js';
for (const [file, anchor] of [['REHBER.md', '#claude-ile-kullanma-mcp'], ['GUIDE.md', '#use-it-from-claude-mcp']]) {
  const md = fs.readFileSync(path.join(ROOT, 'docs', file), 'utf-8');
  const heading = md.split('\n').find(l => /^## .*\(MCP\)$/.test(l)) || '';
  const pasted = (() => { try { return JSON.parse(md.match(/```json\n([\s\S]*?)```/)?.[1]); } catch { return null; } })();
  check(`${file}: the text to paste for the Claude app is valid`, pasted?.mcpServers?.handry?.command === MCP_NODE && pasted.mcpServers.handry.args?.[0] === MCP_SERVER);
  check(`${file}: the Claude Code command uses the same paths`, md.includes(`claude mcp add --scope user handry -- ${MCP_NODE} ${MCP_SERVER}`));
  const section = inChild(`const { markdownToHtml } = await import('./core/guide.js'); console.log(JSON.stringify(markdownToHtml(${JSON.stringify(heading)})));`);
  check(`${file}: the link to the section works in the app`, md.includes(`(${anchor})`) && section.html?.includes(`id="${anchor.slice(1)}"`), heading);
}

const guide = inChild(`const { markdownToHtml } = await import('./core/guide.js'); console.log(JSON.stringify(markdownToHtml('a <b> \`x\`\\n\\n[y](javascript:alert(1))')));`);
check('the guide page shows text as text', guide.html?.includes('&lt;b&gt;') && !guide.html?.includes('href="javascript'));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
