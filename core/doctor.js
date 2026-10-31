// `node cli.js doctor`: checks every part of Handry and says what to fix.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, config, expandHome } from './config.js';
import { APP_NAME, MCP_NAME } from './brand.js';
import { T } from './i18n.js';
import * as jev from './jev.js';
import { listBrains } from '../brain/index.js';
import { findBinary } from '../brain/common.js';
import { sttStatus } from '../voice/stt.js';
import { ttsVoice } from '../voice/tts.js';
import { listRecipes } from './recipes.js';
import { listSecrets } from '../guard/vault.js';
import { isStopped } from '../guard/stop.js';
import { APP_PATH, INSTALLED } from '../app/macos/build.js';
import { autostartEnabled } from '../app/macos/autostart.js';
import { remoteReady } from '../guard/remote-approve.js';

const ok = (label, detail = '') => `✅ ${label}${detail ? ` — ${detail}` : ''}`;
const warn = (label, fix) => `⚠️  ${label} — ${fix}`;

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}

export async function doctor() {
  const lines = [];
  const c = config();

  lines.push(ok('Node', process.version));
  if (jev.jevOff()) {
    lines.push(ok('Jev (TypeSafe)', T("yok; Jev'siz çalışıyor: öğeler kelimeyle bulunuyor, hızlı yol kurallarla (anahtar eklersen Jev'e geçer: .env › JEV_KEY)", 'none; working without it: elements are found by their words, the fast path by rules (add a key to switch to Jev: .env › JEV_KEY)')));
  } else {
    try {
      const t = Date.now();
      await jev.ask({ t: 'merhaba' }, { q: { type: 'noul', instructions: 'Is `t` a greeting?' } });
      lines.push(ok('Jev (TypeSafe)', `${Date.now() - t} ms`));
    } catch (err) {
      lines.push(warn('Jev (TypeSafe)', err.message));
    }
  }

  lines.push(fs.existsSync(c.browser.chromePath) ? ok('Chrome', c.browser.chromePath) : warn('Chrome', `${T('bulunamadı', 'not found')}: ${c.browser.chromePath}`));
  lines.push(await reachable(`http://127.0.0.1:${c.browser.cdpPort}/json/version`)
    ? ok(T(`${APP_NAME} Chrome penceresi`, `${APP_NAME} Chrome window`), T('açık', 'open'))
    : ok(T(`${APP_NAME} Chrome penceresi`, `${APP_NAME} Chrome window`), T('kapalı; ilk tarayıcı komutunda kendiliğinden açılır', 'closed; it opens by itself with the first browser command')));

  try {
    const helper = path.join(ROOT, 'bin', 'jevis-ax');
    if (!fs.existsSync(helper)) execFileSync('swiftc', ['-O', '-o', helper, path.join(ROOT, 'hands', 'ax-helper', 'main.swift')], { stdio: 'pipe' });
    const p = JSON.parse(execFileSync(helper, ['trusted']).toString());
    const access = T('Erişilebilirlik izni', 'Accessibility permission'), screen = T('Ekran Kaydı izni', 'Screen Recording permission');
    lines.push(p.trusted ? ok(access, T('var (bu terminal/uygulama için)', 'given (for this terminal/app)')) : warn(access, T('Sistem Ayarları › Gizlilik ve Güvenlik › Erişilebilirlik', 'System Settings › Privacy & Security › Accessibility')));
    lines.push(p.screenRecording ? ok(screen, T('var', 'given')) : warn(screen, T('Sistem Ayarları › Gizlilik ve Güvenlik › Ekran Kaydı', 'System Settings › Privacy & Security › Screen Recording')));
  } catch (err) {
    lines.push(warn(T('Masaüstü yardımcısı', 'Desktop helper'), `${T('derlenemedi', "couldn't be built")}: ${err.message.slice(0, 100)}`));
  }

  // Reading VS Code switches on its accessibility tree; with the default
  // setting VS Code then turns its editor into "Screen Reader Optimized".
  const vscodeSettings = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  if (fs.existsSync(vscodeSettings)) {
    const text = fs.readFileSync(vscodeSettings, 'utf-8');
    const label = T('VS Code ekran okuyucu modu', 'VS Code screen reader mode');
    lines.push(/"editor\.accessibilitySupport"\s*:\s*"off"/.test(text)
      ? ok(label, T(`kapalı (${APP_NAME} VS Code'u okuyunca editör değişmez)`, `off (the editor stays the same when ${APP_NAME} reads VS Code)`))
      : warn(label, T(`${APP_NAME} VS Code'u okuyunca editör "Screen Reader Optimized" olur. Önlemek için VS Code ayarlarına "editor.accessibilitySupport": "off" ekle.`,
        `when ${APP_NAME} reads VS Code, the editor turns "Screen Reader Optimized". To stop that, add "editor.accessibilitySupport": "off" to the VS Code settings.`)));
  }

  const stt = sttStatus();
  lines.push(stt.ok ? ok(T('Konuşma tanıma (whisper.cpp)', 'Speech recognition (whisper.cpp)'), path.basename(stt.model)) : warn(T('Konuşma tanıma', 'Speech recognition'), stt.reason));
  let voices = '';
  try { voices = execFileSync('say', ['-v', '?']).toString(); } catch {}
  const spoken = T('Sesli cevap', 'Spoken answers');
  const voice = ttsVoice();
  lines.push(voices.includes(voice) ? ok(spoken, voice) : warn(spoken, T(`"${voice}" sesi yok (Sistem Ayarları › Erişilebilirlik › Seslendirilen İçerik)`, `no "${voice}" voice (System Settings › Accessibility › Spoken Content)`)));

  for (const b of await listBrains()) {
    lines.push(b.available ? ok(`${T('Beyin', 'Brain')}: ${b.label}`) : `➖ ${T('Beyin', 'Brain')}: ${b.label} — ${b.reason}`);
  }
  // .mcp.json is personal (absolute paths) and not in git; the user-scope registration below is the usual way.
  if (!findBinary('claude')) lines.push(warn('Claude Code', T('claude komutu bulunamadı (https://claude.com/claude-code)', 'no claude command found (https://claude.com/claude-code)')));
  else if (fs.existsSync(path.join(ROOT, '.mcp.json'))) lines.push(ok(T('Claude Code MCP bağlantısı', 'Claude Code MCP link'), T('.mcp.json (bu klasörde açılan oturumlar)', '.mcp.json (sessions opened in this folder)')));
  // Other Claude sessions using the app's hands: every Claude Code session, and the Claude app.
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; } };
  const everySession = T(`${APP_NAME} her Claude Code oturumunda`, `${APP_NAME} in every Claude Code session`);
  lines.push(readJson(path.join(os.homedir(), '.claude.json'))?.mcpServers?.[MCP_NAME]
    ? ok(everySession, T(`kullanıcı kapsamında MCP "${MCP_NAME}"`, `MCP "${MCP_NAME}" in user scope`))
    : `➖ ${everySession} — ${T('kapalı', 'off')} (claude mcp add --scope user ${MCP_NAME} -- ${process.execPath} ${path.join(ROOT, 'mcp', 'server.js')})`);
  const desktopConfig = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (fs.existsSync(desktopConfig)) {
    const inApp = T(`${APP_NAME} Claude uygulamasında`, `${APP_NAME} in the Claude app`);
    lines.push(readJson(desktopConfig)?.mcpServers?.[MCP_NAME]
      ? ok(inApp, T('ayarlı (Claude uygulamasına Erişilebilirlik ve Ekran Kaydı izni gerekir)', 'set up (the Claude app needs Accessibility and Screen Recording permission)'))
      : `➖ ${inApp} — ${T('ayarlı değil', 'not set up')}`);
  }

  const chatServer = T('Sohbet sunucusu', 'Chat server');
  lines.push(await reachable(`http://127.0.0.1:${c.server.port}/`)
    ? ok(chatServer, `http://localhost:${c.server.port}`)
    : `➖ ${chatServer} — ${T(`kapalı (npm start ya da ${APP_NAME}.app)`, `off (npm start or ${APP_NAME}.app)`)}`);
  lines.push(fs.existsSync(INSTALLED) ? ok(`${APP_NAME}.app`, INSTALLED) : fs.existsSync(APP_PATH)
    ? `➖ ${APP_NAME}.app — ${T('derlendi, kurulmadı', 'built, not installed')} (node cli.js app install)`
    : `➖ ${APP_NAME}.app — ${T('yok', 'not there')} (node cli.js app install)`);
  const atLogin = T('Açılışta başlama', 'Start at login');
  lines.push(autostartEnabled() ? ok(atLogin, T('açık', 'on')) : `➖ ${atLogin} — ${T('kapalı', 'off')} (node cli.js autostart on)`);
  // Approving from the phone: this check runs in the terminal; the app's server needs the same access (Full Disk Access for Handry.app).
  const phone = await remoteReady({ fresh: true });
  const phoneApproval = T('Telefondan onay (iMessage)', 'Approval from the phone (iMessage)');
  lines.push(phone.ok
    ? ok(phoneApproval, T(`Mac'te ${c.confirm.remoteAfterSec ?? 20} sn cevap yoksa kodlu iMessage gider`, `with no answer on the Mac for ${c.confirm.remoteAfterSec ?? 20} s, an iMessage with a code goes out`))
    : `➖ ${phoneApproval} — ${T('kapalı', 'off')}: ${phone.reason}`);
  const phoneCommands = T('Telefondan komut (iMessage)', 'Commands from the phone (iMessage)');
  lines.push(phone.ok && c.phone?.commands !== false
    ? ok(phoneCommands, T(`kendine "${APP_NAME}, …" yaz; ${APP_NAME}.app açıkken çalışır`, `text yourself "${APP_NAME}, …"; works while ${APP_NAME}.app is open`))
    : `➖ ${phoneCommands} — ${T('kapalı', 'off')}${c.phone?.commands === false ? ' (phone.commands false)' : `: ${phone.reason}`}`);
  if (ROOT.startsWith(expandHome('~/Desktop')) || ROOT.startsWith(expandHome('~/Documents'))) {
    lines.push(T(`ℹ️  Proje ${ROOT} içinde: ${APP_NAME}.app ilk açılışta bu klasöre erişim izni ister, "İzin Ver" demen gerekir.`,
      `ℹ️  The project is in ${ROOT}: on first launch ${APP_NAME}.app asks for access to this folder; press "Allow".`));
  }

  lines.push(ok(T('Tarifler', 'Recipes'), T(`${listRecipes().length} adet`, `${listRecipes().length}`)));
  lines.push(ok(T('Kayıtlı şifreler', 'Saved passwords'), T(`${listSecrets().length} adet (Anahtar Zinciri)`, `${listSecrets().length} (Keychain)`)));
  const stop = T('Acil durdurma', 'Emergency stop');
  lines.push(isStopped() ? warn(stop, T('AÇIK — node cli.js resume', 'ON — node cli.js resume')) : ok(stop, T('kapalı', 'off')));
  return lines.join('\n');
}
