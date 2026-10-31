// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Starts the Handry MCP server like Claude Code does (stdio) and calls its tools.
// Usage: node tests/mcp-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const FIXTURE = new URL('./fixtures/appstore-like.html', import.meta.url).href;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../mcp/server.js', import.meta.url).pathname],
  env: { ...process.env, JEVIS_TEST_CONFIRM: 'deny' },
  stderr: 'inherit'
});
const client = new Client({ name: 'jevis-test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} araç: ${tools.map(t => t.name).join(', ')}`);
console.log(`Sunucu talimatı: ${client.getInstructions()?.split('\n')[0]}\n`);

let passed = 0;
let total = 0;
async function call(name, args, check) {
  total++;
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const textOut = res.content.filter(c => c.type === 'text').map(c => c.text).join(' | ');
  const ok = check(res, textOut);
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${String(Date.now() - started).padStart(5)} ms ${name} ${JSON.stringify(args).slice(0, 60)}\n      ${textOut.split('\n').slice(0, 3).join(' / ').slice(0, 160)}`);
}

await call('browser_open', { url: FIXTURE }, (r, t) => !r.isError && t.includes('App Store Connect'));
await call('browser_read', { include_text: false }, (r, t) => t.includes('[textbox] Name') && t.includes('#'));
await call('browser_type', { target: 'Name', text: 'MCP Test App' }, r => !r.isError);
await call('browser_select', { target: 'Price', option: 'Free' }, (r, t) => t.includes('Seçildi: Free'));
await call('browser_click', { target: 'Add for Review' }, (r, t) => r.isError && t.includes('izin vermedi'));
await call('browser_verify', { expectation: 'The Name field contains MCP Test App' }, (r, t) => t.startsWith('Evet'));
await call('browser_screenshot', {}, r => r.content.some(c => c.type === 'image' && c.data.length > 1000));
// Without Jev (no key, JEVIS_JEV=off) jev_ask is not offered.
if (tools.some(t => t.name === 'jev_ask')) {
  await call('jev_ask', {
    state: { reviews: ['Harika uygulama, çok beğendim', 'Sürekli çöküyor, param çöpe gitti'] },
    questions: {
      first_positive: { type: 'noul', instructions: 'Is `reviews[0]` positive?' },
      second_positive: { type: 'noul', instructions: 'Is `reviews[1]` positive?' }
    }
  }, (r, t) => { const a = JSON.parse(t).answers; return a.first_positive.noul > 0.5 && a.second_positive.noul < 0.5; });
} else {
  console.log("⏭️  jev_ask yok (Jev'siz)");
}
await call('handry_do', { command: 'şu an hangi şarkı çalıyor' }, (r, t) => !r.isError && t.startsWith('Yapıldı (hızlı yol'));
await call('handry_do', { command: "Hacker News'i aç ve ilk 5 başlığı özetle" }, (r, t) => !r.isError && t.includes('kendi başına yapamıyor'));
await call('olmayan_arac', {}, r => r.isError);

console.log(`\n${passed}/${total} geçti`);
await client.close();
process.exit(passed === total ? 0 : 1);
