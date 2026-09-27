import readline from 'node:readline';
import { dispatchCommand } from './jev-dispatcher.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const commandArg = process.argv.slice(2).join(' ');

async function executeAndPrint(cmd) {
  if (!cmd.trim()) return;
  console.log(`\n🧠 Jev düşünüyor: "${cmd}"...`);
  try {
    const res = await dispatchCommand(cmd);
    console.log(`⚡ Karar süresi: ${res.latencyMs}ms | Aksiyon: [${res.jevDecisions.action}] | Hedef: [${res.jevDecisions.targetApp}]`);
    console.log('---------------------------------------------------------');
    res.executionResults.forEach(r => {
      if (r.success) {
        console.log(`✅ ${r.message}`);
      } else {
        console.log(`❌ ${r.error || r.message}`);
      }
    });
    console.log('---------------------------------------------------------\n');
  } catch (err) {
    console.error(`💥 Hata: ${err.message}\n`);
  }
}

if (commandArg) {
  // Single command mode
  await executeAndPrint(commandArg);
  process.exit(0);
} else {
  // Interactive CLI loop
  console.log('=========================================================');
  console.log('🎙️ JEV macOS Sesli & Doğal Dil Komut Satırı');
  console.log('Örnekler:');
  console.log('  - "Spotify\'ı aç ve sesi 40 yap"');
  console.log('  - "Karanlık modu değiştir"');
  console.log('  - "Ekran görüntüsü al"');
  console.log('  - "Hesap makinesini aç"');
  console.log('  - "Çıkmak için \'q\' veya \'exit\' yazın"');
  console.log('=========================================================\n');

  function promptUser() {
    rl.question('macOS Komutu > ', async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'q') {
        rl.close();
        process.exit(0);
      }
      await executeAndPrint(trimmed);
      promptUser();
    });
  }

  promptUser();
}
