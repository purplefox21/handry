#!/usr/bin/env node
// JEVIS komut satırı. Bütün komutlar callTool'dan geçer: acil durdurma,
// eylem kaydı ve sayfa bekçisi burada da geçerli.
import { callTool } from './core/tools.js';
import * as browser from './hands/browser.js';
import * as vault from './guard/vault.js';
import { requestStop, clearStop } from './guard/stop.js';
import { recentActions } from './guard/log.js';
import { runCommand } from './core/runner.js';
import * as desktop from './hands/desktop.js';
import { transcribe } from './voice/stt.js';
import { speak } from './voice/tts.js';
import { config, homeDir } from './core/config.js';
import path from 'node:path';

const HELP = `JEVIS komutları

Komut ver (hızlı yol ya da beyin)
  do "<komut>" [--brain=claude-code] [--no-fast] [--say]
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
  mac <eylem> [değer]                 volume 40, mute, next_track, dark_mode, notify "…", spotify_search "…"

Şifreler (macOS Anahtar Zinciri)
  secret add <isim> --site=site1.com,site2.com   Şifreyi sorar, sadece bu sitelerde kullanılır
  secret list | secret rm <isim>
  secret fill "<hedef>" <isim>        Kayıtlı şifreyi alana yaz

Koruma
  stop                                Acil durdurma (10 dk ya da resume'a kadar)
  resume                              Durdurmayı kaldır
  log [adet]                          Son eylemler
`;

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
      shot: ['desktop_screenshot', { app, full_screen: flags.has('--full') }]
    };
    if (!map[sub]) throw new Error('desk alt komutları: read, click, type, write, key, shot');
    return map[sub];
  }
};

async function secretCommand() {
  const [sub, ...params] = args;
  if (sub === 'add') {
    const sites = (flagValue('--site') || '').split(',').filter(Boolean);
    if (!params[0] || !sites.length) return 'Kullanım: secret add <isim> --site=site1.com,site2.com';
    console.log(`"${params[0]}" için şifreyi yaz (ekranda görünmez, iki kez sorulur):`);
    vault.addSecretInteractive(params[0], sites);
    return `✅ "${params[0]}" kaydedildi. İzinli siteler: ${sites.join(', ')}`;
  }
  if (sub === 'rm') {
    await vault.removeSecret(params[0]);
    return `Silindi: ${params[0]}`;
  }
  if (sub === 'fill') {
    return printResult(await callTool('browser_fill_secret', { target: params[0], secret: params[1] }));
  }
  const list = vault.listSecrets();
  return list.length ? list.map(s => `${s.name} — ${s.sites.join(', ')}`).join('\n') : 'Kayıtlı şifre yok.';
}

function printResult(res) {
  const out = res.content.map(c => (c.type === 'text' ? c.text : `[görüntü: ${Math.round(c.data.length * 0.75 / 1024)} KB]`)).join('\n');
  if (res.isError) throw new Error(out);
  return out;
}

function printEvent(ev) {
  if (ev.type === 'route') console.log(ev.route === 'needs_brain' ? `🧠 beyne gidiyor (Jev %${ev.confidence})` : `⚡ hızlı yol: ${ev.route} (Jev %${ev.confidence}, ${ev.ms} ms)`);
  if (ev.type === 'status') console.log(`… ${ev.text}`);
  if (ev.type === 'tool') console.log(`🔧 ${ev.name} ${JSON.stringify(ev.args || {}).slice(0, 100)}`);
  if (ev.type === 'tool_result') console.log(`   ${ev.isError ? '❌' : '↳'} ${String(ev.text).split('\n')[0].slice(0, 140)}`);
  if (ev.type === 'text') console.log(`💬 ${ev.text}`);
}

async function doCommand(text) {
  const out = await runCommand({ text, brainId: flagValue('--brain') || config().brain.default, fast: !flags.has('--no-fast'), onEvent: printEvent });
  if (flags.has('--say') && out.text) await speak(out.text);
  return `✅ ${out.text || 'Bitti.'}\n(${(out.ms / 1000).toFixed(1)} sn${out.fast ? ', beyin kullanılmadı' : ''})`;
}

async function run() {
  if (cmd === 'do') return doCommand(args.join(' '));
  if (cmd === 'listen') {
    const seconds = Number(args[0]) || config().voice.recordSeconds;
    const file = path.join(homeDir('tmp'), 'listen.wav');
    console.log(`🎙️ ${seconds} saniye dinliyorum…`);
    await desktop.record(seconds, file);
    const heard = await transcribe(file);
    if (!heard) return 'Bir şey duyamadım.';
    console.log(`🗣️ Duyulan: ${heard}`);
    return flags.has('--do') ? doCommand(heard) : heard;
  }
  if (cmd === 'stop') {
    requestStop('CLI');
    return '⛔ Acil durdurma açık. Kaldırmak için: node cli.js resume';
  }
  if (cmd === 'resume') {
    clearStop();
    return '▶️ Durdurma kaldırıldı.';
  }
  if (cmd === 'log') {
    return recentActions(Number(args[0]) || 15).reverse()
      .map(e => `${e.ts.slice(11, 19)} ${e.ok ? '✅' : '❌'} ${e.tool} ${JSON.stringify(e.args).slice(0, 70)} (${e.ms} ms)`).join('\n') || 'Kayıt yok.';
  }
  if (cmd === 'secret') return secretCommand();
  if (cmd === 'shot') {
    clearStop();
    const s = await browser.screenshot({ fullPage: flags.has('--full') });
    return `Ekran görüntüsü: ${s.path}`;
  }
  if (TOOL_COMMANDS[cmd]) {
    clearStop(); // a command typed by the user means "go on"
    const [name, toolArgs] = TOOL_COMMANDS[cmd]();
    return printResult(await callTool(name, toolArgs));
  }
  return HELP;
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
