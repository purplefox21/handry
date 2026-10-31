#!/usr/bin/env node
// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Handry komut satırı. Bütün komutlar callTool'dan geçer: acil durdurma,
// eylem kaydı ve sayfa bekçisi burada da geçerli.
import { callTool } from './core/tools.js';
import { APP_NAME, COPYRIGHT } from './core/brand.js';
import { T } from './core/i18n.js';
import * as browser from './hands/browser.js';
import * as vault from './guard/vault.js';
import { requestStop, clearStop } from './guard/stop.js';
import { recentActions } from './guard/log.js';
import { runCommand, runRecipeWithHandoff } from './core/runner.js';
import { listRecipes, loadRecipe, saveFromRun, deleteRecipe } from './core/recipes.js';
import { getBrain } from './brain/index.js';
import { loadState } from './core/config.js';
import { doctor } from './core/doctor.js';
import { buildApp, installApp, INSTALLED } from './app/macos/build.js';
import { enableAutostart, disableAutostart, autostartEnabled } from './app/macos/autostart.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as desktop from './hands/desktop.js';
import { transcribe } from './voice/stt.js';
import { speak } from './voice/tts.js';
import { config, homeDir } from './core/config.js';
import path from 'node:path';

const help = () => `${APP_NAME} · ${COPYRIGHT}\n\n` + T(`${APP_NAME} komutları

Komut ver (hızlı yol ya da beyin)
  do "<komut>" [--new] [--brain=claude-code] [--model=claude-sonnet-5-5] [--effort=high] [--no-fast] [--say]
                                      Çubuk ve pencereyle aynı sohbete yazılır (--new: yeni sohbet)
  listen [saniye] [--do] [--say]       Mikrofonu dinle, yazıya çevir (--do: çalıştır)

Tarayıcı
  open <adres|arama> [--new]          Sayfayı aç (--new: yeni sekmede)
  read [--no-text]                    Sayfadaki öğeleri (#id) ve metni listele
  click "<hedef>"                     Tıkla. Hedef: "Kaydet butonu" ya da "#12"
  type "<hedef>" "<metin>" [--enter] [--append]
  select "<hedef>" "<seçenek>"
  check "<hedef>" [on|off]
  upload "<hedef>" <dosya>
  press <tuş>                         Örn: Enter, Escape, Meta+A
  scroll [down|up] [piksel]
  back
  tabs | tab <no|metin> | close-tab [no|metin]
  shot [--full]                       Ekran görüntüsü (~/.jevis/shots)
  verify "<beklenti>"                 Sayfa bu durumda mı? (Jev karar verir)
  wait "<metin>"                      Metin görünene kadar bekle
  show "<hedef>" [--desk --app=X] [--shape=arrow|circle|underline|box|note] [--note="…"] [--sec=N] | show --clear
                                      Ekranda göster: tıklamadan ok, daire, alt çizgi, kutu (Handry.app çizer)
  login-window [adres]                Google gibi girişi engelleyen siteler için: Chrome profili bağlantısız açılır, girişi sen yaparsın
  code sms|gmail [--from=kelime] [--wait=sn] [--target="<alan>"]
                                      Telefona/e-postaya gelen son doğrulama kodunu oku (önce sorar)

Tarifler (bir işi kaydet, beyinsiz tekrar oynat)
  recipe list | recipe show <isim> | recipe rm <isim>
  recipe save <isim> [--last | --run=<id>]   Son işi (ya da verilen işi) tarif yap
  recipe run <isim> [--var=ad=değer …]       Takılırsa beyin kaldığı yerden devam eder

Mac uygulamaları
  apps                                Açık uygulamalar
  app <isim>                          Uygulamayı aç / öne getir ("Hesap Makinesi", "Xcode")
  quit <isim>                         Uygulamayı kapat
  desk read [--app=X] [--menus]       Ön penceredeki kontroller (#d1…) ve metinler
  desk click "<hedef>" [--app=X]      Buton, menü öğesi, sekme… (menüler de aranır)
  desk type "<hedef>" "<metin>" [--app=X] [--enter]
  desk write "<metin>"                Odaktaki alana yaz
  desk key <kısayol>                  Örn: cmd+s, escape, return
  desk shot [--full]                  Ön pencerenin ekran görüntüsü
  desk space [left|right|N] [--display=N]   Masaüstleri (Spaces): listele, sağa/sola, N. masaüstüne git
  mac <eylem> [değer]                 volume 40, mute, next_track, dark_mode, notify "…", spotify_search "…"

Uygulama ve kurulum
  doctor                              Her şeyi kontrol et, eksikleri söyle
  app build | app install | app open  Menü çubuğu uygulaması (⌥Space, ⌥⇧Space bas-konuş, ⌥Esc durdur)
  autostart on | off | status         Bilgisayar açılınca ${APP_NAME} başlasın

Şifreler (macOS Anahtar Zinciri)
  secret add <isim> --site=site1.com,site2.com   Şifreyi sorar, sadece bu sitelerde kullanılır
  secret list | secret rm <isim>
  secret fill "<hedef>" <isim>        Kayıtlı şifreyi alana yaz

Haber verme (giriş ya da onay beklerken)
  notify set <telefon|Apple ID>       1 dk cevap yoksa bu adrese iMessage gider (~/.jevis/config.json)
  notify test                         Deneme iMessage'ı gönder
  notify off                          iMessage'ı kapat
                                      Telefondan onay: Mac'teki onaya 20 sn cevap yoksa kodlu iMessage gelir,
                                      kodu kendine yazınca onaylanır, "hayır" reddeder (Tam Disk Erişimi gerekir)

Koruma
  stop                                Acil durdurma (10 dk ya da resume'a kadar)
  resume                              Durdurmayı kaldır
  log [adet]                          Son eylemler
`, `${APP_NAME} commands

Give a command (fast path or brain)
  do "<command>" [--new] [--brain=claude-code] [--model=claude-sonnet-5-5] [--effort=high] [--no-fast] [--say]
                                      Goes to the same chat as the bar and the window (--new: a new chat)
  listen [seconds] [--do] [--say]     Listen to the microphone and write it down (--do: run it)

Browser
  open <address|search> [--new]       Open the page (--new: in a new tab)
  read [--no-text]                    List the page's elements (#id) and text
  click "<target>"                    Click. Target: "Save button" or "#12"
  type "<target>" "<text>" [--enter] [--append]
  select "<target>" "<option>"
  check "<target>" [on|off]
  upload "<target>" <file>
  press <key>                         E.g. Enter, Escape, Meta+A
  scroll [down|up] [pixels]
  back
  tabs | tab <no|text> | close-tab [no|text]
  shot [--full]                       Screenshot (~/.jevis/shots)
  verify "<expectation>"              Is the page in this state? (Jev decides)
  wait "<text>"                       Wait until the text shows up
  show "<target>" [--desk --app=X] [--shape=arrow|circle|underline|box|note] [--note="…"] [--sec=N] | show --clear
                                      Show it on the screen without clicking: arrow, circle, underline, box (Handry.app draws it)
  login-window [address]              For sites like Google that block the sign-in: the Chrome profile opens unattached, you sign in yourself
  code sms|gmail [--from=word] [--wait=sec] [--target="<field>"]
                                      Read the latest verification code sent to your phone/e-mail (asks first)

Recipes (record a task, replay it without the brain)
  recipe list | recipe show <name> | recipe rm <name>
  recipe save <name> [--last | --run=<id>]   Make the last task (or the given one) a recipe
  recipe run <name> [--var=name=value …]      If it gets stuck, the brain goes on from there

Mac apps
  apps                                Open apps
  app <name>                          Open an app / bring it to the front ("Calculator", "Xcode")
  quit <name>                         Quit the app
  desk read [--app=X] [--menus]       Controls (#d1…) and texts of the front window
  desk click "<target>" [--app=X]     Button, menu item, tab… (menus are searched too)
  desk type "<target>" "<text>" [--app=X] [--enter]
  desk write "<text>"                 Type into the focused field
  desk key <shortcut>                 E.g. cmd+s, escape, return
  desk shot [--full]                  Screenshot of the front window
  desk space [left|right|N] [--display=N]   Desktops (Spaces): list, move right/left, go to desktop N
  mac <action> [value]                volume 40, mute, next_track, dark_mode, notify "…", spotify_search "…"

App and setup
  doctor                              Check everything, say what's missing
  app build | app install | app open  Menu bar app (⌥Space, ⌥⇧Space push-to-talk, ⌥Esc stop)
  autostart on | off | status         Start ${APP_NAME} when the Mac starts

Passwords (macOS Keychain)
  secret add <name> --site=site1.com,site2.com   Asks for the password; it's used only on these sites
  secret list | secret rm <name>
  secret fill "<target>" <name>       Type a saved password into the field

Getting your attention (while waiting for a login or an approval)
  notify set <phone|Apple ID>         With no answer for 1 min, an iMessage goes to this address (~/.jevis/config.json)
  notify test                         Send a test iMessage
  notify off                          Turn the iMessage off
                                      Approval from the phone: with no answer on the Mac for 20 s, an iMessage with a code comes;
                                      text the code to yourself to approve, "no" refuses (needs Full Disk Access)

Safety
  stop                                Emergency stop (10 min or until resume)
  resume                              Lift the stop
  log [count]                         Recent actions
`);

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')).map(a => a.split('=')[0]));
const flagValue = name => rest.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
const args = rest.filter(a => !a.startsWith('--'));

const TOOL_COMMANDS = {
  open: () => ['browser_open', { url: args.join(' '), new_tab: flags.has('--new') }],
  read: () => ['browser_read', { include_text: !flags.has('--no-text') }],
  click: () => ['browser_click', { target: args.join(' ') }],
  act: () => ['browser_click', { target: args.join(' ') }],
  type: () => ['browser_type', { target: args[0], text: args.slice(1).join(' '), press_enter: flags.has('--enter'), append: flags.has('--append') }],
  select: () => ['browser_select', { target: args[0], option: args.slice(1).join(' ') }],
  check: () => ['browser_check', { target: args[0], checked: args[1] !== 'off' }],
  upload: () => ['browser_upload', { target: args[0], file_path: args[1] }],
  press: () => ['browser_press', { key: args[0] }],
  scroll: () => ['browser_scroll', { direction: args[0] || 'down', pixels: Number(args[1]) || 600 }],
  back: () => ['browser_back', {}],
  tabs: () => ['browser_tabs', { action: 'list' }],
  tab: () => ['browser_tabs', { action: 'switch', tab: args.join(' ') }],
  'close-tab': () => ['browser_tabs', { action: 'close', tab: args.length ? args.join(' ') : undefined }],
  verify: () => ['browser_verify', { expectation: args.join(' ') }],
  wait: () => ['browser_wait', { text: args.join(' ') }],
  show: () => (flags.has('--clear') ? ['screen_draw', { clear: true }] : ['screen_draw', { shape: flagValue('--shape') || 'arrow', [flags.has('--desk') ? 'desktop' : 'browser']: args.join(' '), app: flagValue('--app'), note: flagValue('--note'), seconds: Number(flagValue('--sec')) || undefined }]),
  'login-window': () => ['login_window', { url: args[0] }],
  code: () => ['verification_code', { source: args[0], from: flagValue('--from'), wait_sec: Number(flagValue('--wait')) || undefined, target: flagValue('--target') }],
  apps: () => ['desktop_apps', {}],
  app: () => ['desktop_open_app', { name: args.join(' ') }],
  quit: () => ['desktop_quit_app', { name: args.join(' ') }],
  mac: () => ['mac_action', { action: args[0], value: args.slice(1).join(' ') || undefined }],
  desk: () => {
    const [sub, ...params] = args;
    const app = flagValue('--app');
    const map = {
      read: ['desktop_read', { app, include_menus: flags.has('--menus') }],
      click: ['desktop_click', { target: params.join(' '), app }],
      type: ['desktop_type', { target: params[0], text: params.slice(1).join(' '), app, press_enter: flags.has('--enter') }],
      write: ['desktop_type', { text: params.join(' '), press_enter: flags.has('--enter') }],
      key: ['desktop_key', { keys: params[0], app }],
      shot: ['desktop_screenshot', { app, full_screen: flags.has('--full') }],
      space: ['desktop_space', /^\d+$/.test(params[0] || '') ? { to: Number(params[0]), display: Number(flagValue('--display')) || undefined } : params[0] ? { direction: params[0], display: Number(flagValue('--display')) || undefined } : {}]
    };
    if (!map[sub]) throw new Error(T('desk alt komutları: read, click, type, write, key, shot, space', 'desk subcommands: read, click, type, write, key, shot, space'));
    return map[sub];
  }
};

async function secretCommand() {
  const [sub, ...params] = args;
  if (sub === 'add') {
    const sites = (flagValue('--site') || '').split(',').filter(Boolean);
    if (!params[0] || !sites.length) return T('Kullanım: secret add <isim> --site=site1.com,site2.com', 'Usage: secret add <name> --site=site1.com,site2.com');
    console.log(T(`"${params[0]}" için şifreyi yaz (ekranda görünmez, iki kez sorulur):`, `Type the password for "${params[0]}" (it isn't shown; you're asked twice):`));
    vault.addSecretInteractive(params[0], sites);
    return T(`✅ "${params[0]}" kaydedildi. İzinli siteler: ${sites.join(', ')}`, `✅ "${params[0]}" saved. Allowed sites: ${sites.join(', ')}`);
  }
  if (sub === 'rm') {
    await vault.removeSecret(params[0]);
    return `${T('Silindi', 'Removed')}: ${params[0]}`;
  }
  if (sub === 'fill') {
    return printResult(await callTool('browser_fill_secret', { target: params[0], secret: params[1] }));
  }
  const list = vault.listSecrets();
  return list.length ? list.map(s => `${s.name} — ${s.sites.join(', ')}`).join('\n') : T('Kayıtlı şifre yok.', 'No saved passwords.');
}

function printResult(res) {
  const out = res.content.map(c => (c.type === 'text' ? c.text : `[${T('görüntü', 'image')}: ${Math.round(c.data.length * 0.75 / 1024)} KB]`)).join('\n');
  if (res.isError) throw new Error(out);
  return out;
}

function printEvent(ev) {
  if (ev.type === 'route') console.log(ev.route === 'needs_brain'
    ? T(`🧠 beyne gidiyor (Jev %${ev.confidence})`, `🧠 going to the brain (Jev ${ev.confidence}%)`)
    : T(`⚡ hızlı yol: ${ev.route} (Jev %${ev.confidence}, ${ev.ms} ms)`, `⚡ fast path: ${ev.route} (Jev ${ev.confidence}%, ${ev.ms} ms)`));
  if (ev.type === 'status') console.log(`… ${ev.text}`);
  if (ev.type === 'tool') console.log(`🔧 ${ev.name} ${JSON.stringify(ev.args || {}).slice(0, 100)}`);
  if (ev.type === 'tool_result') console.log(`   ${ev.isError ? '❌' : '↳'} ${String(ev.text).split('\n')[0].slice(0, 140)}`);
  if (ev.type === 'text') console.log(`💬 ${ev.text}`);
}

// The iMessage address is personal: it goes to ~/.jevis/config.json, not the repo.
async function notifyCommand() {
  const file = path.join(homeDir(), 'config.json');
  const user = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; } })();
  if (args[0] === 'set' && args[1]) {
    user.notify = { ...(user.notify || {}), imessageTo: args[1] };
    fs.writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
    return T(`✅ ${APP_NAME} seni 1 dakika bekleyince ${args[1]} adresine iMessage atacak. Denemek için: node cli.js notify test`,
      `✅ After waiting 1 minute for you, ${APP_NAME} will send an iMessage to ${args[1]}. To try it: node cli.js notify test`);
  }
  if (args[0] === 'off') {
    user.notify = { ...(user.notify || {}), imessageTo: '' };
    fs.writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
    return T('iMessage kapatıldı.', 'iMessage turned off.');
  }
  if (args[0] === 'test') {
    const { sendIMessage } = await import('./guard/notify.js');
    await sendIMessage(T(`${APP_NAME} deneme: bu mesaj geldiyse giriş ya da onay gerektiğinde sana buradan haber vereceğim.`,
      `${APP_NAME}: a test. If this message came, I'll tell you here when a login or an approval is needed.`), user.notify?.imessageTo || config().notify?.imessageTo);
    return T('✅ Gönderildi. Telefonuna geldiyse hazır.', "✅ Sent. If it reached your phone, you're all set.");
  }
  return T('Kullanım: notify set <telefon ya da Apple ID> | notify test | notify off', 'Usage: notify set <phone or Apple ID> | notify test | notify off');
}

async function doCommand(text) {
  // The same chat as the Handry bar and window (--new starts a fresh one).
  if (flags.has('--new')) (await import('./core/chats.js')).newChat();
  const out = await runCommand({ text, brainId: flagValue('--brain') || config().brain.default, fast: !flags.has('--no-fast'), model: flagValue('--model'), effort: flagValue('--effort'), onEvent: printEvent, source: 'cli' });
  if (flags.has('--say') && out.text) await speak(out.text);
  return `✅ ${out.text || T('Bitti.', 'Done.')}\n(${(out.ms / 1000).toFixed(1)} ${T('sn', 's')}${out.fast ? T(', beyin kullanılmadı', ', no brain used') : ''})`;
}

async function recipeCommand() {
  const [sub, name] = args;
  if (sub === 'save') {
    const runId = flagValue('--run') || loadState().lastRunId;
    if (!runId) return T('Kaydedilecek bir iş yok. Önce bir komut çalıştır.', 'There is no task to save. Run a command first.');
    const r = saveFromRun(name, runId);
    return T(`📌 "${r.name}" kaydedildi: ${r.steps.length} adım (recipes/${r.name}.json)`, `📌 "${r.name}" saved: ${r.steps.length} steps (recipes/${r.name}.json)`);
  }
  if (sub === 'show') return JSON.stringify(loadRecipe(name), null, 2);
  if (sub === 'rm') { deleteRecipe(name); return `${T('Silindi', 'Removed')}: ${name}`; }
  if (sub === 'run') {
    const vars = Object.fromEntries(rest.filter(a => a.startsWith('--var=')).map(a => a.slice(6).split(/=(.*)/s).slice(0, 2)));
    const out = await runRecipeWithHandoff({ name, vars, brain: getBrain(flagValue('--brain') || config().brain.default), onEvent: printEvent });
    return `✅ ${out.text}`;
  }
  const list = listRecipes();
  return list.length
    ? list.map(r => `📌 ${r.name} — ${r.steps} ${T('adım', 'steps')}${r.vars.length ? ` (${T('değişkenler', 'variables')}: ${r.vars.join(', ')})` : ''}${r.description ? ` — ${r.description}` : ''}`).join('\n')
    : T('Henüz tarif yok.', 'No recipes yet.');
}

async function run() {
  if (cmd === 'doctor') return doctor();
  if (cmd === 'app') {
    if (args[0] === 'build') return `${T('Derlendi', 'Built')}: ${buildApp()}`;
    if (args[0] === 'install') return T(`Kuruldu: ${installApp()}\nAçmak için: node cli.js app open`, `Installed: ${installApp()}\nTo open it: node cli.js app open`);
    if (args[0] === 'open') {
      execFileSync('open', [fs.existsSync(INSTALLED) ? INSTALLED : buildApp()]);
      return T(`${APP_NAME} açıldı: menü çubuğundaki el simgesi (✋). ⌥Space sohbet, ⌥⇧Space bas-konuş, ⌥Esc acil durdur.`,
        `${APP_NAME} is open: the hand icon in the menu bar (✋). ⌥Space chat, ⌥⇧Space push-to-talk, ⌥Esc emergency stop.`);
    }
    return T('Kullanım: app build | app install | app open', 'Usage: app build | app install | app open');
  }
  if (cmd === 'autostart') {
    if (args[0] === 'on') {
      const target = fs.existsSync(INSTALLED) ? INSTALLED : installApp();
      enableAutostart(target);
      return T(`✅ ${APP_NAME} bilgisayar açılınca başlayacak (${target}).`, `✅ ${APP_NAME} will start when the Mac starts (${target}).`);
    }
    if (args[0] === 'off') { disableAutostart(); return T('Açılışta başlama kapatıldı.', 'Start at login is off.'); }
    return autostartEnabled() ? T('Açılışta başlama: açık', 'Start at login: on') : T('Açılışta başlama: kapalı', 'Start at login: off');
  }
  if (cmd === 'recipe') return recipeCommand();
  if (cmd === 'do') return doCommand(args.join(' '));
  if (cmd === 'listen') {
    const seconds = Number(args[0]) || config().voice.recordSeconds;
    const file = path.join(homeDir('tmp'), 'listen.wav');
    console.log(T(`🎙️ ${seconds} saniye dinliyorum…`, `🎙️ Listening for ${seconds} seconds…`));
    await desktop.record(seconds, file);
    const heard = await transcribe(file);
    if (!heard) return T('Bir şey duyamadım.', "I didn't hear anything.");
    console.log(`🗣️ ${T('Duyulan', 'Heard')}: ${heard}`);
    return flags.has('--do') ? doCommand(heard) : heard;
  }
  if (cmd === 'stop') {
    requestStop('CLI');
    return T('⛔ Acil durdurma açık. Kaldırmak için: node cli.js resume', '⛔ Emergency stop is on. To lift it: node cli.js resume');
  }
  if (cmd === 'resume') {
    clearStop();
    return T('▶️ Durdurma kaldırıldı.', '▶️ The stop is lifted.');
  }
  if (cmd === 'log') {
    return recentActions(Number(args[0]) || 15).reverse()
      .map(e => `${e.ts.slice(11, 19)} ${e.ok ? '✅' : '❌'} ${e.tool} ${JSON.stringify(e.args).slice(0, 70)} (${e.ms} ms)`).join('\n') || T('Kayıt yok.', 'Nothing logged.');
  }
  if (cmd === 'secret') return secretCommand();
  if (cmd === 'notify') return notifyCommand();
  if (cmd === 'shot') {
    clearStop();
    const s = await browser.screenshot({ fullPage: flags.has('--full') });
    return `${T('Ekran görüntüsü', 'Screenshot')}: ${s.path}`;
  }
  if (TOOL_COMMANDS[cmd]) {
    clearStop(); // a command typed by the user means "go on"
    const [name, toolArgs] = TOOL_COMMANDS[cmd]();
    return printResult(await callTool(name, toolArgs));
  }
  return help();
}

const started = Date.now();
try {
  console.log(await run());
  if (cmd && TOOL_COMMANDS[cmd]) console.log(`(${Date.now() - started} ms)`);
  process.exit(0);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
