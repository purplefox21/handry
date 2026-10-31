// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Desktops (Spaces) on the real screen: listing each display's desktops and
// which one is shown, moving right/left and to a numbered desktop (checked by
// the desktop picture the display shows), the pointer coming back to where it
// was, desktop_windows listing windows on other desktops, and
// desktop_focus_window going to a window on another desktop. Needs a display
// with two or more desktops; the last check needs some app with a window on a
// desktop that isn't shown (it is skipped, and says so, if there is none).
// Everything is put back at the end: each display's desktop and the front window.
// Usage: node tests/spaces-e2e.mjs
const desktop = await import('../hands/desktop.js');
const { callTool } = await import('../core/tools.js');
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};
const { execFileSync } = await import('node:child_process');
const helper = (...a) => JSON.parse(execFileSync(new URL('../bin/jevis-ax', import.meta.url).pathname, a.map(String)).toString());

let passed = 0, total = 0, skipped = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = r && typeof r === 'object' && 'ok' in r ? Boolean(r.ok) : Boolean(r); note = r?.note || ''; if (r?.skip) { skipped++; ok = true; note = `ATLANDI: ${r.skip}`; } } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const start = await desktop.spaces();
const front = await desktop.frontmost();
const pointer = helper('cursor');
const shown = async n => (await desktop.spaces()).find(d => d.display === n)?.current;

try {
  await check('Her ekranın masaüstleri ve gösterilen masaüstü okunuyor', async () => {
    const r = await call('desktop_space', {});
    return { ok: !r.isError && start.length > 0 && start.every(d => d.spaces.length > 0) && start.some(d => d.current), note: r.text.replace(/\n/g, ' / ') };
  });

  const d = start.find(x => x.main && x.spaces.length > 1) || start.find(x => x.spaces.length > 1);
  await check('Sağa / sola geçiş gerçekten oluyor ve imleç yerine dönüyor', async () => {
    if (!d || !d.current) return { skip: 'iki ya da daha çok masaüstü olan ekran yok' };
    const [first, second] = d.current < d.spaces.length ? ['right', 'left'] : ['left', 'right'];
    const a = await call('desktop_space', { direction: first, display: d.display });
    const mid = await shown(d.display);
    const b = await call('desktop_space', { direction: second, display: d.display });
    const end = await shown(d.display);
    const p = helper('cursor');
    const back = Math.abs(p.x - pointer.x) < 3 && Math.abs(p.y - pointer.y) < 3;
    return { ok: !a.isError && !b.isError && mid === d.current + (first === 'right' ? 1 : -1) && end === d.current && back, note: `${d.current} → ${mid} → ${end}, imleç yerinde: ${back}` };
  });

  await check('Numaralı masaüstüne gidiş ve geri dönüş', async () => {
    if (!d || !d.current) return { skip: 'iki ya da daha çok masaüstü olan ekran yok' };
    const target = d.current === 1 ? d.spaces.length : 1;
    const a = await call('desktop_space', { to: target, display: d.display });
    const there = await shown(d.display);
    const b = await call('desktop_space', { to: d.current, display: d.display });
    const end = await shown(d.display);
    return { ok: !a.isError && !b.isError && there === target && end === d.current, note: `${d.current} → ${there} → ${end}` };
  });

  // A window that is surely on another desktop: open a TextEdit document there, then come back. (A window
  // that is only "not on screen" may as well be a hidden one; macOS doesn't tell which.)
  let away = null;
  const normal = d ? d.spaces.map((x, n) => (x.fullscreen ? null : n + 1)).filter(n => n && n !== d.current) : [];
  if (d?.current && normal.length) {
    await call('desktop_quit_app', { name: 'TextEdit' }).catch(() => {});
    await desktop.switchSpace({ to: normal[0], display: d.display });
    await call('desktop_open_app', { name: 'TextEdit' });
    await new Promise(res => setTimeout(res, 800));
    const doc = async () => (await desktop.windows('TextEdit')).windows.find(w => /Adsız|Untitled/.test(w.title));
    for (let i = 0; i < 3 && !(await doc()); i++) { await call('desktop_key', { keys: 'cmd+n', app: 'TextEdit' }); await new Promise(res => setTimeout(res, 700)); }
    away = await doc();
    await desktop.switchSpace({ to: d.current, display: d.display });
  }
  await check('desktop_windows başka masaüstündeki pencereyi de listeliyor', async () => {
    if (!away) return { skip: 'başka bir masaüstünde TextEdit belgesi açılamadı (iki normal masaüstü gerekiyor)' };
    const r = await call('desktop_windows', { app: 'TextEdit' });
    return { ok: !r.isError && r.text.includes('Ekranda değil') && r.text.includes(away.title), note: r.text.replace(/\n/g, ' / ') };
  });
  await check('desktop_focus_window başka masaüstündeki pencereye gidiyor', async () => {
    if (!away) return { skip: 'başka bir masaüstünde TextEdit belgesi açılamadı' };
    const r = await call('desktop_focus_window', { app: 'TextEdit', window: away.title });
    const f = await desktop.frontmost();
    const at = await shown(d.display);
    return { ok: !r.isError && f.app === 'TextEdit' && f.window === away.title && at === normal[0], note: `önde: ${f.app} — ${f.window}, masaüstü ${at}` };
  });
} finally {
  await call('desktop_quit_app', { name: 'TextEdit' }).catch(() => {}); // an empty new document closes without asking
  // put everything back: each display's desktop, then the window that was in front
  for (const s of start) if (s.current) await desktop.switchSpace({ to: s.current, display: s.display }).catch(() => {});
  if (front?.app && front.window) await desktop.focusWindow(front.app, front.window).catch(() => {});
}

const now = await desktop.spaces();
console.log(`\nGeri kondu: ${now.map(x => `ekran ${x.display} → ${x.current}`).join(', ')} (başlangıç: ${start.map(x => `ekran ${x.display} → ${x.current}`).join(', ')})`);
console.log(`${passed}/${total} geçti${skipped ? ` (${skipped} atlandı)` : ''}`);
process.exit(passed === total ? 0 : 1);
