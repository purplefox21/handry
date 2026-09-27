#!/usr/bin/env node
// JEVIS komut satırı. Bütün komutlar callTool'dan geçer: acil durdurma,
// eylem kaydı ve sayfa bekçisi burada da geçerli.
import { callTool } from './core/tools.js';
import * as browser from './hands/browser.js';
import * as vault from './guard/vault.js';
import { requestStop, clearStop } from './guard/stop.js';
import { recentActions } from './guard/log.js';

const HELP = `JEVIS komutları

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
  wait: () => ['browser_wait', { text: args.join(' ') }]
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
  const out = res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (res.isError) throw new Error(out);
  return out;
}

async function run() {
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
