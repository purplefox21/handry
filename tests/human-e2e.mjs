// Does Handry move and type like a person when asked to, and stay fast when
// not? Real Chrome in its own profile and port (the Handry Chrome you use is
// not touched); a page records every mouse and key event, and the test checks
// what a site would see: a curved, gradual pointer path, a held click, wheel
// ticks for scrolling, one key event per character instead of a value that
// appears at once. Also the human_mode tool and the hint on a block page.
// Usage: node tests/human-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jevis-human-'));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ browser: { cdpPort: 9477, profileDir: path.join(home, 'chrome-profile') } }));
process.env.JEVIS_HOME = home;
delete process.env.JEVIS_HUMAN;
process.env.JEVIS_TEST_CONFIRM = 'allow';
const b = await import('../hands/browser.js');
const human = await import('../hands/human.js');
const { callTool } = await import('../core/tools.js');
const call = async (name, args) => {
  const r = await callTool(name, args);
  return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
};

const FIXTURE = new URL('./fixtures/human-probe.html', import.meta.url).href;
const dom = async fn => (await b.activePage()).evaluate(fn);
const events = () => dom(() => window.__ev);
const clear = () => dom(() => { window.__ev.length = 0; window.__clicked.length = 0; });

let passed = 0, total = 0;
async function check(name, fn) {
  total++;
  const started = Date.now();
  let ok = false, note = '';
  try { const r = await fn(); ok = Boolean(r?.ok ?? r); note = r?.note || ''; } catch (err) { note = err.stack?.split('\n').slice(0, 2).join(' ') || err.message; }
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(6)} ms  ${name}${note ? `\n          → ${note}` : ''}`);
}

const inputs = ev => ev.filter(e => e.t === 'input').length;
const google = { url: () => 'https://accounts.google.com/v3/signin' };
const other = { url: () => 'https://example.com/' };

try {
  await b.open(FIXTURE);
  const listing = b.formatRead(await b.read({ text: false }), { all: true });
  const id = word => {
    const line = listing.split('\n').find(l => new RegExp(word, 'i').test(l) && /^#\d+/.test(l));
    return line ? line.match(/^#(\d+)/)[0] : word;
  };

  // --- default: fast and plain ---------------------------------------------
  await check('Varsayılan kapalı: yazma tek input olayı, tıklama ışınlanır (hızlı)', async () => {
    await clear();
    const t = Date.now();
    await b.type(id('Email'), 'Bora.Test@example.com');
    await b.click(id('Continue'));
    const ev = await events();
    const moves = ev.filter(e => e.t === 'mousemove').length;
    return { ok: inputs(ev) === 1 && moves <= 4 && !human.humanOn(google), note: `${inputs(ev)} input, ${moves} fare olayı, ${Date.now() - t} ms` };
  });

  await check('human_mode durum: kapalı, hızlı mod', async () => {
    const r = await call('human_mode', {});
    return { ok: /Kapalı: hızlı mod/.test(r.text), note: r.text };
  });

  await check('human_mode: dosya sayfasında site belli değil → anlaşılır hata', async () => {
    const r = await call('human_mode', { on: true });
    return { ok: /Olmadı/.test(r.text) && !human.describeMode().sites.length, note: r.text };
  });

  // --- site scope -------------------------------------------------------------
  await check('human_mode site: sadece o site (google.com), diğerleri hızlı', async () => {
    const r = await call('human_mode', { on: true, site: 'accounts.google.com' });
    const ok = human.humanOn(google) && human.humanOn({ url: () => 'https://mail.google.com/' }) && !human.humanOn(other);
    return { ok: ok && /google\.com/.test(r.text), note: r.text };
  });

  await check('human_mode site kapat: sadece o site kapanır', async () => {
    await call('human_mode', { on: true, site: 'example.org' });
    await call('human_mode', { on: false, site: 'google.com' });
    const m = human.describeMode();
    await call('human_mode', { on: false });
    return { ok: !m.sites.includes('google.com') && m.sites.includes('example.org') && human.describeMode().sites.length === 0, note: JSON.stringify(m) };
  });

  // --- everything, for a while ------------------------------------------------
  await check('human_mode all: dakika sayacıyla açılır', async () => {
    const r = await call('human_mode', { on: true, scope: 'all', minutes: 5 });
    return { ok: human.humanOn(other) && human.desktopHumanOn() && human.describeMode().all >= 4 && /Her şeyde açık/.test(r.text), note: r.text };
  });

  await check('Açıkken e-posta: harf harf yazılıyor (her karakter için tuş olayı)', async () => {
    await clear();
    const text = 'Bora.Test@example.com';
    const t = Date.now();
    await b.type(id('Email'), text);
    const took = Date.now() - t;
    const ev = await events();
    const keydowns = ev.filter(e => e.t === 'keydown').length;
    const value = await dom(() => document.getElementById('email').value);
    return { ok: value === text && inputs(ev) >= text.length && keydowns >= text.length && took > text.length * 50, note: `değer ${value === text ? 'doğru' : value}, ${inputs(ev)} input, ${keydowns} tuş, ${took} ms` };
  });

  await check('Büyük harf ve simge Shift ile yazılıyor, tuş kodları gerçek', async () => {
    const ev = await events();
    const shiftDowns = ev.filter(e => e.t === 'keydown' && e.k === 'Shift').length;
    const code = ev.find(e => e.t === 'keydown' && e.k === 'B')?.code;
    return { ok: shiftDowns >= 1 && code === 'KeyB' && ev.every(e => e.trusted), note: `Shift ${shiftDowns}, B → ${code}` };
  });

  await check('Parola (fillHidden): harf harf, değer doğru', async () => {
    await clear();
    const pw = 'Tr0ub4dor&3';
    await b.fillHidden(id('Password'), pw);
    const ev = await events();
    const value = await dom(() => document.getElementById('password').value);
    return { ok: value === pw && inputs(ev) >= pw.length, note: `${inputs(ev)} input olayı` };
  });

  await check('Eski içerik seçilip yerine yazılıyor', async () => {
    await b.type(id('Email'), 'a@b.co');
    return dom(() => document.getElementById('email').value === 'a@b.co');
  });

  await check('Tıklama: eğri yol, ışınlanma yok, tuş basılı kalıyor', async () => {
    await clear();
    await b.click(id('Continue'));
    const ev = await events();
    const moves = ev.filter(e => e.t === 'mousemove');
    const down = ev.find(e => e.t === 'mousedown'), up = ev.find(e => e.t === 'mouseup');
    let maxStep = 0, maxBow = 0;
    for (let i = 1; i < moves.length; i++) maxStep = Math.max(maxStep, Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y));
    if (moves.length > 2) {
      const a = moves[0], z = moves[moves.length - 1], len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
      for (const m of moves) maxBow = Math.max(maxBow, Math.abs((z.x - a.x) * (a.y - m.y) - (a.x - m.x) * (z.y - a.y)) / len);
    }
    const clicked = await dom(() => window.__clicked);
    const hold = up && down ? up.at - down.at : 0;
    return { ok: clicked.join() === 'go' && moves.length >= 10 && maxStep < 90 && maxBow > 1 && hold >= 40, note: `${moves.length} fare olayı, en büyük sıçrama ${Math.round(maxStep)} px, eğrilik ${maxBow.toFixed(1)} px, basılı kalma ${hold} ms` };
  });

  await check('Sayfanın altındaki düğme: tekerlekle kayıp tıklanıyor', async () => {
    await clear();
    await b.click(id('Far away'));
    const ev = await events();
    const wheels = ev.filter(e => e.t === 'wheel').length;
    const clicked = await dom(() => window.__clicked);
    return { ok: clicked.join() === 'far' && wheels >= 5, note: `${wheels} tekerlek olayı` };
  });

  await check('Açıkken uzun metin (>120 karakter) yine tek seferde giriyor', async () => {
    await clear();
    await b.type(id('Email'), 'Uzun metin '.repeat(20));
    return { ok: inputs(await events()) === 1 };
  });

  await check('JEVIS_HUMAN=0 kilidi: mod açık olsa da kapalı kalır (human_mode açamaz)', async () => {
    process.env.JEVIS_HUMAN = '0';
    try {
      await clear();
      await b.type(id('Email'), 'kapali@ornek.com');
      const r = await call('human_mode', {});
      return { ok: inputs(await events()) === 1 && !human.humanOn(other) && /kapalı tutuluyor/.test(r.text), note: r.text };
    } finally { delete process.env.JEVIS_HUMAN; }
  });

  await check('JEVIS_HUMAN=1 her yerde açar', async () => {
    await call('human_mode', { on: false });
    process.env.JEVIS_HUMAN = '1';
    try { return human.humanOn(other) && human.desktopHumanOn(); } finally { delete process.env.JEVIS_HUMAN; }
  });

  await check('human_mode kapat (kapsamsız): her şey kapanır, yazma yine hızlı', async () => {
    await call('human_mode', { on: true, scope: 'all', minutes: 5 });
    await call('human_mode', { on: true, site: 'google.com' });
    const r = await call('human_mode', { on: false });
    await clear();
    await b.type(id('Email'), 'hizli@ornek.com');
    const m = human.describeMode();
    return { ok: m.all === 0 && m.sites.length === 0 && inputs(await events()) === 1 && /Kapalı/.test(r.text), note: r.text };
  });

  // --- the brain is told when a page blocks automation --------------------------
  await check('Engel sayfası: sonuç human_mode önerir', async () => {
    const r = await call('browser_open', { url: new URL('./fixtures/blocked.html', import.meta.url).href });
    return { ok: /human_mode/.test(r.text) && /Couldn.t sign you in|may not be secure/i.test(r.text) && !/zaten açıktı/.test(r.text), note: r.text.split('\n').slice(-2).join(' ').slice(0, 220) };
  });

  await check('Engel sayfası, mod zaten açıkken: tekrar deneme demez, elle yapmayı ister', async () => {
    await call('human_mode', { on: true, scope: 'all', minutes: 5 });
    const r = await call('browser_open', { url: new URL('./fixtures/blocked.html', import.meta.url).href + '?again' });
    await call('human_mode', { on: false });
    return { ok: /zaten açıktı/.test(r.text) && /login_window/.test(r.text), note: r.text.split('\n').slice(-1)[0].slice(0, 200) };
  });

  await check('browser_read de engeli söylüyor', async () => {
    const r = await call('browser_read', {});
    return { ok: /human_mode/.test(r.text) };
  });
} finally {
  console.log(`\n${passed}/${total}`);
  try { (await b.activePage()).context().browser()?.close().catch(() => {}); } catch {}
  await new Promise(r => setTimeout(r, 300));
  try { const { execSync } = await import('node:child_process'); execSync(`pkill -f "user-data-dir=${home}" || true`); } catch {}
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(passed === total ? 0 : 1);
}
