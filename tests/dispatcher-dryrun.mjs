// Checks Jev's decisions and the argument extraction of jev-dispatcher.js
// without touching the Mac (dryRun). Usage: node tests/dispatcher-dryrun.mjs
import { dispatchCommand } from '../jev-dispatcher.js';

const cases = [
  { cmd: "Notlara 'Market' diye not aç içine Ali'ye süt al yaz", expect: "createNote(\"Market\",\"Ali'ye süt al\")" },
  { cmd: "Safaride YouTube'a gir jev macOS yaz arat", expect: 'openWebSearch("jev macOS","youtube","safari")' },
  { cmd: 'sonraki şarkıya geç', expect: 'mediaControl("next")' },
  { cmd: 'bir önceki şarkıyı aç', expect: 'mediaControl("previous")' },
  { cmd: 'müziği durdur', expect: 'mediaControl("play_pause")' },
  { cmd: 'sesi yüzde 35 yap', expect: 'setVolume(35)' },
];

let passed = 0;
for (const { cmd, expect } of cases) {
  const res = await dispatchCommand(cmd, null, { dryRun: true });
  const got = res.executionResults.map(r => r.message.replace('(deneme) ', '').replace(/, /g, ',')).join(' + ');
  const ok = got === expect;
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(res.latencyMs).padStart(4)}ms  "${cmd}"\n      → ${got}${ok ? '' : `\n      beklenen: ${expect}`}`);
}
console.log(`\n${passed}/${cases.length} doğru`);
process.exit(passed === cases.length ? 0 : 1);
