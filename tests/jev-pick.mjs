// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
import fs from 'node:fs';
const key = fs.readFileSync(new URL('../.env', import.meta.url),'utf8').match(/JEV_KEY=(.+)/)[1].trim();
// App Store Connect benzeri bir sayfadaki tıklanabilir öğeler (sahte ama gerçekçi)
const els = ["Apps","Analytics","Sales and Trends","Payments and Financial Reports","Users and Access","Agreements, Tax, and Banking","Help","Account menu",
 "App Store tab","Services tab","TestFlight tab","Xcode Cloud tab","iOS App 1.0 Prepare for Submission","App Information","Pricing and Availability","App Privacy","Ratings and Reviews","Version History","In-App Purchases","Subscriptions","App Store Promotions","Custom Product Pages","In-App Events","Product Page Optimization",
 "Save button","Add for Review button","Name text field","Subtitle text field","Category primary dropdown","Category secondary dropdown","Content Rights: Edit","Age Rating: Edit","Privacy Policy URL text field","User Privacy Choices URL text field","License Agreement: Edit","Bundle ID dropdown","SKU text field","Apple ID (read only)","Primary Language dropdown","Upload screenshots area","Promotional Text text field","Description text area","Keywords text field","Support URL text field","Marketing URL text field","Version text field","Copyright text field","Routing App Coverage File: Choose File","Sign-in required checkbox","Contact first name field","Contact last name field","Contact phone field","Contact email field","Notes text area","Attachment: Choose File","Manual release radio","Automatic release radio","Phased release checkbox","Reset rating checkbox","Build: Add Build button"];
const criteria = Object.fromEntries(els.map((e,i)=>[`e${i}`, e]));
criteria.none = 'None of the elements matches the instruction';
const tests = ["fiyatlandırma sayfasına git","yaş sınırı ayarlarını düzenle","açıklama kısmına yazacağım","kaydet","destek linkini gireceğim yer","incelemeye gönder","uygulamanın gizlilik anketini aç","otomatik yayınlama seçeneğini işaretle","dark mode'u aç"];
for (const cmd of tests) {
  const t = Date.now();
  const r = await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body: JSON.stringify({model:'jev-latest', state:{ page:'App Store Connect – app page', user_instruction: cmd },
      questions:{ target:{ type:'choice', instructions:'Which on-screen element should be clicked or focused to carry out `user_instruction` on this `page`?', criteria } }})});
  const j = await r.json();
  if (!r.ok) { console.log('HATA', r.status, JSON.stringify(j).slice(0,300)); break; }
  const a = j.answers.target; const pick = a.choice === 'none' ? '— (hiçbiri)' : criteria[a.choice];
  console.log(`${String(Date.now()-t).padStart(4)}ms  güven=${(a.confidence*100|0)}%  "${cmd}" → ${pick}`);
}
console.log(`(${els.length} aday öğe)`);
