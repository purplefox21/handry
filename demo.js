import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. API Anahtarını .env dosyasından oku
let apiKey = process.env.JEV_KEY || process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  const match = envContent.match(/(?:JEV_KEY|TYPESAFE_API_KEY)=([^\r\n]+)/);
  if (match) apiKey = match[1].trim();
}

console.log("🔑 API Anahtarı yüklendi:", apiKey.slice(0, 15) + "...");

// 2. TypeSafe Jev API'sini çağıran yardımcı fonksiyon
async function askJev(state, questions) {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      state,
      model: 'jev-latest',
      questions
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TypeSafe API Hatası (${response.status}): ${err}`);
  }

  return await response.json();
}

// 3. GERÇEK YAZILIM SENARYOSU (Backend'deki Kullanım)
async function main() {
  console.log("\n=======================================================");
  console.log("⚡ SENARYO: E-Ticaret Canlı Müşteri Destek Yönlendiricisi");
  console.log("=======================================================");

  // State: Düz metin olmak zorunda değil! JSON objesi olarak tüm sistem verisini verebilirsin:
  const applicationState = {
    customer: {
      name: "Ahmet Yılmaz",
      tier: "VIP",
      registered_email: "ahmet@example.com"
    },
    ticket: {
      channel: "live_chat",
      text: "3 gündür ödeme sistemine bağlanamıyorum ve müşterilerime satış yapamıyorum! Acil teknik destek verin, her saat binlerce lira zarar ediyorum, böyle rezalet olmaz!"
    },
    system_status: {
      payment_gateway: "degraded_performance"
    }
  };

  // Sorular (Primitives): Tek istekte aynı anda birden fazla karar soruyoruz!
  const questions = {
    // 1. Choice: Hangi ekibe gidecek?
    "department": {
      "type": "choice",
      "instructions": "Which department should handle this ticket?",
      "criteria": {
        "technical_support": "API issues, system errors, payment integration failures",
        "billing_refunds": "Invoice requests, direct refund demands, pricing questions",
        "sales_account": "Upgrade plans, purchasing new services"
      }
    },

    // 2. Noul (Evet/Hayır): Acil mi?
    "is_urgent": {
      "type": "noul",
      "instructions": "Does the customer express critical urgency or business loss?"
    },

    // 3. Score (Derecelendirme): Müşteri ne kadar sinirli? (0: Sakin, 1: Rahatsız, 2: Çok Öfkeli)
    "frustration_level": {
      "type": "score",
      "instructions": "How frustrated or angry is the customer in `ticket.text`?",
      "criteria": [
        "Calm, just reporting facts",
        "Mildly annoyed or impatient",
        "Furious, angry, shouting or aggressive tone"
      ]
    }
  };

  console.log("⏳ Jev değerlendiriyor...");
  const t0 = Date.now();
  const evaluation = await askJev(applicationState, questions);
  const duration = Date.now() - t0;

  console.log(`✅ Karar alındı (${duration} ms)\n`);

  // 4. KODUN İÇİNDE NASIL KULLANILIR? (İşte aradığın kod mantığı burada!)
  const { department, is_urgent, frustration_level } = evaluation.answers;

  console.log("--- JEV'DEN GELEN HAM CEVAPLAR ---");
  console.log("1. Departman:", department.choice, `(Güven: %${Math.round(department.confidence * 100)})`);
  console.log("2. Acil mi?:", is_urgent.noul >= 0.5 ? "EVET" : "HAYIR", `(Olasılık: %${Math.round(is_urgent.noul * 100)})`);
  console.log("3. Öfke Puanı (0-2):", frustration_level.score.toFixed(2), `(Güven: %${Math.round(frustration_level.confidence * 100)})`);

  console.log("\n--- KOD BLOKLARININ (IF / SWITCH) ÇALIŞMASI ---");

  // A) Departmana Göre Routing (Switch - Case)
  switch (department.choice) {
    case 'technical_support':
      console.log("➡️ AKSİYON: Teknik Destek Slack kanalına bildirim düşürüldü (#tech-alerts).");
      break;
    case 'billing_refunds':
      console.log("➡️ AKSİYON: Muhasebe kuyruğuna alındı.");
      break;
    case 'sales_account':
      console.log("➡️ AKSİYON: Satış temsilcisi atandı.");
      break;
  }

  // B) Aciliyet ve Öfke Seviyesine Göre Önceliklendirme (IF Mantığı)
  if (is_urgent.noul > 0.8 && frustration_level.score > 1.2) {
    console.log("🚨 KRİTİK ALARM: VIP Müşteri çok öfkeli ve acil para kaybı yaşıyor! Nöbetçi mühendis telefonuna SMS gönderildi.");
  } else {
    console.log("ℹ️ Standart SLA süresi uygulandı (2 saat içinde yanıt).");
  }

  // C) Model Emin Değilse Ne Yapılır? (Confidence Check)
  if (department.confidence < 0.6) {
    console.log("⚠️ UYARI: Jev bu departman seçiminden çok emin olamadı, bir operatörün göz atması iyi olur.");
  } else {
    console.log("🛡️ GÜVENLİ: Karar yüksek güvenilirlikle otomatik uygulandı.");
  }
}

main().catch(console.error);
