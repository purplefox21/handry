// `node cli.js doctor`: checks every part of JEVIS and says what to fix.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, config, expandHome } from './config.js';
import * as jev from './jev.js';
import { listBrains } from '../brain/index.js';
import { findBinary } from '../brain/common.js';
import { sttStatus } from '../voice/stt.js';
import { listRecipes } from './recipes.js';
import { listSecrets } from '../guard/vault.js';
import { isStopped } from '../guard/stop.js';
import { APP, INSTALLED } from '../app/macos/build.js';
import { autostartEnabled } from '../app/macos/autostart.js';

const ok = (label, detail = '') => `✅ ${label}${detail ? ` — ${detail}` : ''}`;
const warn = (label, fix) => `⚠️  ${label} — ${fix}`;

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}

export async function doctor() {
  const lines = [];
  const c = config();

  lines.push(ok('Node', process.version));
  try {
    const t = Date.now();
    await jev.ask({ t: 'merhaba' }, { q: { type: 'noul', instructions: 'Is `t` a greeting?' } });
    lines.push(ok('Jev (TypeSafe)', `${Date.now() - t} ms`));
  } catch (err) {
    lines.push(warn('Jev (TypeSafe)', err.message));
  }

  lines.push(fs.existsSync(c.browser.chromePath) ? ok('Chrome', c.browser.chromePath) : warn('Chrome', `bulunamadı: ${c.browser.chromePath}`));
  lines.push(await reachable(`http://127.0.0.1:${c.browser.cdpPort}/json/version`)
    ? ok('JEVIS Chrome penceresi', 'açık')
    : ok('JEVIS Chrome penceresi', 'kapalı; ilk tarayıcı komutunda kendiliğinden açılır'));

  try {
    const helper = path.join(ROOT, 'bin', 'jevis-ax');
    if (!fs.existsSync(helper)) execFileSync('swiftc', ['-O', '-o', helper, path.join(ROOT, 'hands', 'ax-helper', 'main.swift')], { stdio: 'pipe' });
    const p = JSON.parse(execFileSync(helper, ['trusted']).toString());
    lines.push(p.trusted ? ok('Erişilebilirlik izni', 'var (bu terminal/uygulama için)') : warn('Erişilebilirlik izni', 'Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik'));
    lines.push(p.screenRecording ? ok('Ekran Kaydı izni', 'var') : warn('Ekran Kaydı izni', 'Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı'));
  } catch (err) {
    lines.push(warn('Masaüstü yardımcısı', `derlenemedi: ${err.message.slice(0, 100)}`));
  }

  const stt = sttStatus();
  lines.push(stt.ok ? ok('Konuşma tanıma (whisper.cpp)', path.basename(stt.model)) : warn('Konuşma tanıma', stt.reason));
  let voices = '';
  try { voices = execFileSync('say', ['-v', '?']).toString(); } catch {}
  lines.push(voices.includes(c.voice.ttsVoice) ? ok('Sesli cevap', c.voice.ttsVoice) : warn('Sesli cevap', `"${c.voice.ttsVoice}" sesi yok (Sistem Ayarları › Erişilebilirlik › Seslendirilen İçerik)`));

  for (const b of await listBrains()) {
    lines.push(b.available ? ok(`Beyin: ${b.label}`) : `➖ Beyin: ${b.label} — ${b.reason}`);
  }
  lines.push(fs.existsSync(path.join(ROOT, '.mcp.json')) && findBinary('claude')
    ? ok('Claude Code MCP bağlantısı', '.mcp.json (bu klasörde açılan oturumlar)')
    : warn('Claude Code MCP bağlantısı', '.mcp.json ya da claude komutu yok'));

  lines.push(await reachable(`http://127.0.0.1:${c.server.port}/`)
    ? ok('Sohbet sunucusu', `http://localhost:${c.server.port}`)
    : `➖ Sohbet sunucusu — kapalı (npm start ya da JEVIS.app)`);
  lines.push(fs.existsSync(INSTALLED) ? ok('JEVIS.app', INSTALLED) : fs.existsSync(APP) ? `➖ JEVIS.app — derlendi, kurulmadı (node cli.js app install)` : `➖ JEVIS.app — yok (node cli.js app install)`);
  lines.push(autostartEnabled() ? ok('Açılışta başlama', 'açık') : '➖ Açılışta başlama — kapalı (node cli.js autostart on)');
  if (ROOT.startsWith(expandHome('~/Desktop')) || ROOT.startsWith(expandHome('~/Documents'))) {
    lines.push(`ℹ️  Proje ${ROOT} içinde: JEVIS.app ilk açılışta bu klasöre erişim izni ister, "İzin Ver" demen gerekir.`);
  }

  lines.push(ok('Tarifler', `${listRecipes().length} adet`));
  lines.push(ok('Kayıtlı şifreler', `${listSecrets().length} adet (Anahtar Zinciri)`));
  lines.push(isStopped() ? warn('Acil durdurma', 'AÇIK — node cli.js resume') : ok('Acil durdurma', 'kapalı'));
  return lines.join('\n');
}
