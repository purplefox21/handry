// Claude Code in VS Code, where the user can watch it (claude_start /
// claude_send), and being told when a session is done. Works in a throwaway
// Handry home with made-up Claude Code sessions and transcripts; notices and
// iMessages are only written down. Checks: a session is found by its name,
// project or id (several or none: an error that lists them); a terminal
// session is refused before anything on the screen is touched; a project is
// found by its folder or name; the watch says once that a session waits for
// an answer and, when it is done, sends Claude's last answer (bar + iMessage).
// With --live it also really opens a Claude tab in this project's VS Code
// window, sends a one-word task, writes to that session again, and closes the
// tab (two very short Claude turns; VS Code may ask once whether the Claude
// extension may open Handry's link: that answer is the user's).
// Usage: node tests/vscode-claude-e2e.mjs [--live]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const live = process.argv.includes('--live');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'handry-vscode-claude-'));
const sessionsDir = path.join(home, 'claude-sessions');
const projectsDir = path.join(home, 'claude-projects');
fs.mkdirSync(sessionsDir);
fs.mkdirSync(projectsDir);
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ notify: { imessageTo: 'test@example.com', imessageAfterSec: 1 } }));
Object.assign(process.env, {
  JEVIS_HOME: home, JEVIS_TEST_NOTIFY: 'record', JEVIS_TIMER_TICK_MS: '200', JEVIS_TIMER_STABLE_MS: '600',
  ...(live ? {} : { JEVIS_CLAUDE_SESSIONS_DIR: sessionsDir, JEVIS_CLAUDE_PROJECTS_DIR: projectsDir })
});
delete process.env.JEVIS_NO_TIMERS;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const notices = () => { try { return fs.readFileSync(path.join(home, 'notify-test.log'), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return null; };

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const children = [];
try {
  if (!live) {
    // Made-up sessions: VS Code ones and a terminal one, each a sleeping child process.
    const session = (name, cwd, status, entrypoint = 'claude-vscode') => {
      const child = spawn('sleep', ['300']);
      children.push(child);
      const s = { pid: child.pid, sessionId: `s-${child.pid}`, cwd, name, entrypoint, status, statusUpdatedAt: Date.now() };
      fs.writeFileSync(path.join(sessionsDir, `${child.pid}.json`), JSON.stringify(s));
      return { ...s, set: (status, extra = {}) => fs.writeFileSync(path.join(sessionsDir, `${child.pid}.json`), JSON.stringify({ ...s, status, statusUpdatedAt: Date.now(), ...extra })) };
    };
    const shop = session('shop-api', path.join(os.homedir(), 'Desktop', 'shop'), 'busy');
    const web1 = session('web-1a', path.join(os.homedir(), 'Desktop', 'web'), 'idle');
    session('web-2b', path.join(os.homedir(), 'Desktop', 'web'), 'idle');
    const term = session('cli-işi', path.join(os.homedir(), 'Desktop', 'tools'), 'idle', 'cli');
    // shop-api's transcript: what Claude answered last
    const log = path.join(projectsDir, '-Users-x-Desktop-shop');
    fs.mkdirSync(log);
    const at = n => new Date(Date.now() - n * 1000).toISOString();
    fs.writeFileSync(path.join(log, `${shop.sessionId}.jsonl`), [
      { type: 'user', cwd: shop.cwd, timestamp: at(60), message: { role: 'user', content: 'testleri çalıştır' } },
      { type: 'assistant', timestamp: at(30), message: { role: 'assistant', content: [{ type: 'text', text: 'Bakıyorum.' }] } },
      { type: 'assistant', timestamp: at(5), message: { role: 'assistant', content: [{ type: 'text', text: 'Testler geçti: 12/12. Bir uyarı düzelttim.' }] } }
    ].map(l => JSON.stringify(l)).join('\n'));

    const vc = await import('../hands/vscode-claude.js');
    const timers = await import('../core/timers.js');
    const { callTool } = await import('../core/tools.js');

    await check('Oturum adından, projesinden ya da id\'sinden bulunuyor; birden çoksa ya da yoksa liste veriyor', () => {
      const byName = vc.findSession('shop-api').pid === shop.pid;
      const byProject = vc.findSession('shop').pid === shop.pid;
      const byId = vc.findSession(web1.sessionId).pid === web1.pid;
      const many = (() => { try { vc.findSession('web'); } catch (e) { return e.code === 'AMBIGUOUS' && /web-1a/.test(e.message) && /web-2b/.test(e.message); } })();
      const none = (() => { try { vc.findSession('yok-böyle'); } catch (e) { return e.code === 'NOT_FOUND' && /shop-api/.test(e.message); } })();
      return { ok: byName && byProject && byId && many && none, note: `ad ${byName}, proje ${byProject}, id ${byId}, çok ${many}, yok ${none}` };
    });

    await check('Terminaldeki oturuma yazmıyor: ekrana dokunmadan söylüyor', async () => {
      const r = await callTool('claude_send', { session: term.name, text: 'devam et' });
      const t = r.content.map(c => c.text).join(' ');
      return { ok: r.isError && /sadece VS Code/.test(t), note: t };
    });

    await check('Proje klasör yolundan ya da adından bulunuyor; olmayan proje hata', async () => {
      const byPath = await vc.projectDir('~/Desktop/jev');
      const byName = await vc.projectDir(path.basename(ROOT)).catch(e => e.message); // VS Code's own list of opened folders
      const missing = await vc.projectDir('hiç-olmayan-proje-xyz').then(() => null, e => e.code);
      return { ok: byPath === ROOT && byName === ROOT && missing === 'NOT_FOUND', note: `${byPath} | ${byName} | ${missing}` };
    });

    timers.startScheduler({ run: async () => {} });
    await check('Haber verme: cevap beklerken bir kez söylüyor, bitince son cevabı çubuğa ve iMessage\'a yazıyor', async () => {
      const job = timers.addJob({ action: 'report', until: { claude: [{ pid: shop.pid, sessionId: shop.sessionId, name: shop.name, project: 'shop' }] }, every: 300 });
      const label = timers.describe(job);
      shop.set('waiting', { waitingFor: 'izin: Bash' });
      const asked = await waitFor(() => notices().find(n => /senden cevap bekliyor/.test(n.message || '')));
      await sleep(700);
      const askedOnce = notices().filter(n => /senden cevap bekliyor/.test(n.message || '')).length === 1;
      shop.set('idle');
      const done = await waitFor(() => notices().find(n => n.title === 'Claude' && /bitti/.test(n.message || '')));
      const phone = await waitFor(() => notices().find(n => /^Handry: "shop-api" \(shop\) bitti\. Son cevabı: Testler geçti: 12\/12/.test(n.imessage || '')), 4000);
      const gone = !timers.listJobs().some(j => j.id === job.id);
      return { ok: Boolean(asked && askedOnce && done && phone && gone) && label === '👀 "shop-api" bitince → haber ver', note: `${label} | ${done?.message || 'bitti yok'} | iMessage: ${phone ? 'var' : 'yok'}` };
    });
    timers.stopScheduler();
  } else {
    // The real thing: a new Claude tab in this project's VS Code window.
    process.env.JEVIS_HOME = home;
    const { callTool } = await import('../core/tools.js');
    const { claudeSessions } = await import('../hands/claude-sessions.js');
    const { sessionReport } = await import('../hands/files.js');
    const desktop = await import('../hands/desktop.js');
    let made = null;
    const idle = async pid => waitFor(() => claudeSessions().find(s => s.pid === pid && s.state === 'idle'), 90000);

    await check('claude_start: jev penceresinde yeni sekme, görev gönderildi, Claude cevap verdi', async () => {
      const r = await callTool('claude_start', { project: ROOT, task: "Handry testi: hiçbir araç kullanma, sadece 'tamam' yaz.", notify: false });
      made = r.meta?.session;
      if (r.isError || !made) return { ok: false, note: r.content.map(c => c.text).join(' ') };
      await sleep(3000);
      await idle(made.pid);
      const last = sessionReport(made.sessionId)?.lastReply || '';
      return { ok: /tamam/i.test(last), note: `"${made.name}": ${last}` };
    });

    await check('claude_send: aynı oturuma ikinci mesaj gitti, Claude cevap verdi', async () => {
      if (!made) return { ok: false, note: 'oturum yok' };
      const r = await callTool('claude_send', { session: made.sessionId, text: "Şimdi sadece 'ikinci' yaz, araç kullanma.", notify: false });
      if (r.isError) return { ok: false, note: r.content.map(c => c.text).join(' ') };
      await sleep(3000);
      await idle(made.pid);
      const last = sessionReport(made.sessionId)?.lastReply || '';
      const tabs = (await desktop.read({ app: 'Code', remember: false })).elements.filter(e => e.role === 'RadioButton' && e.y < 120).map(e => e.name);
      return { ok: /ikinci/i.test(last), note: `${last} | sekmeler: ${tabs.join(', ')}` };
    });

    // close the test tab (the one in front, holding the test session)
    if (made) {
      const r = await desktop.read({ app: 'Code', remember: false });
      const i = r.elements.findIndex(e => e.role === 'RadioButton' && String(e.value) === '1' && e.y < 120);
      const close = r.elements[i + 1];
      if (i >= 0 && close?.name?.startsWith('Close')) await desktop.pressPath(close.path, { pid: r.pid, expect: close.name }).catch(() => {});
    }
  }
} finally {
  for (const c of children) c.kill();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed}/${total} geçti`);
process.exit(passed === total ? 0 : 1);
