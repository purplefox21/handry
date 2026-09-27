#!/usr/bin/env node
// JEVIS komut satırı: tarayıcıyı adım adım yönetmek ve test etmek için.
import * as browser from './hands/browser.js';

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
`;

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const args = rest.filter(a => !a.startsWith('--'));

async function run() {
  switch (cmd) {
    case 'open':
      return browser.formatOutcome(await browser.open(args.join(' '), { newTab: flags.has('--new') }));
    case 'read':
      return browser.formatRead(await browser.read({ text: !flags.has('--no-text') }));
    case 'click':
    case 'act':
      return browser.formatOutcome(await browser.click(args.join(' ')));
    case 'type':
      return browser.formatOutcome(await browser.type(args[0], args.slice(1).join(' '), { submit: flags.has('--enter'), append: flags.has('--append') }));
    case 'select':
      return browser.formatOutcome(await browser.select(args[0], args.slice(1).join(' ')));
    case 'check':
      return browser.formatOutcome(await browser.check(args[0], args[1] !== 'off'));
    case 'upload':
      return browser.formatOutcome(await browser.upload(args[0], args[1]));
    case 'press':
      return browser.formatOutcome(await browser.press(args[0]));
    case 'scroll': {
      const r = await browser.scroll(args[0] || 'down', Number(args[1]) || 600);
      return `Kaydırıldı: ${r.scrollY} / ${r.maxY} px`;
    }
    case 'back':
      return browser.formatOutcome(await browser.back());
    case 'tabs':
      return (await browser.tabs()).map(t => `${t.active ? '▶' : ' '} ${t.index}. ${t.title} — ${t.url}`).join('\n');
    case 'tab':
      return browser.formatOutcome(await browser.switchTab(args.join(' ')));
    case 'close-tab': {
      const t = await browser.closeTab(args.length ? args.join(' ') : undefined);
      return `Kapatıldı: ${t.title}`;
    }
    case 'shot': {
      const s = await browser.screenshot({ fullPage: flags.has('--full') });
      return `Ekran görüntüsü: ${s.path}`;
    }
    case 'verify': {
      const v = await browser.verify(args.join(' '));
      return `${v.yes ? '✅ Evet' : '❌ Hayır'} (%${v.p}) — ${v.expectation}`;
    }
    default:
      return HELP;
  }
}

const started = Date.now();
try {
  console.log(await run());
  if (cmd) console.log(`(${Date.now() - started} ms)`);
  process.exit(0);
} catch (err) {
  console.error(`❌ ${browser.formatError(err)}`);
  process.exit(1);
}
