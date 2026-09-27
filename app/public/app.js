// Per-start session token injected by server.js; required on every /api call.
const JEVIS_TOKEN = document.querySelector('meta[name="jevis-token"]')?.content || '';

// Presets data
const PRESETS = {
  birds: {
    state: `Bir hayvanat bahçesindeyiz. İki farklı canlıyı gözlemliyoruz:
1. Kutup Pengueni: Soğuk sularda yüzer, kanat benzeri yüzgeçleri vardır.
2. Çiftlik Tavuğu: Kanatları vardır, yem arar, tehlike anında çırpınır.`,
    questions: {
      "penguen_kanat": {
        type: "noul",
        instructions: "Penguenin anatomik olarak kanadı (veya kanat yapısı) var mıdır?",
        criteria: {
          "true": "Evet, penguen bir kuştur ve kanat yapısına sahiptir",
          "false": "Hayır, kanatları yoktur"
        }
      },
      "penguen_ucabilir_mi": {
        type: "noul",
        instructions: "Penguen gökyüzünde kuşlar gibi uçabilir mi?",
        criteria: {
          "true": "Evet, havada uçabilir",
          "false": "Hayır, havada uçamaz, sadece yüzer"
        }
      },
      "tavuk_ucma_yetenegi": {
        type: "choice",
        instructions: "Tavuğun uçma kabiliyeti en iyi nasıl tarif edilir?",
        criteria: {
          "hic_havalanamaz": "Tavuk asla yerden kesilemez, hiç uçamaz",
          "kisa_mesafe_cirpinir": "Kanat çırparak kısa süreliğine birkaç metre havalanabilir ama uzun mesafe uçamaz",
          "gokyuzunde_uzun_sure_suzulur": "Kartal veya martı gibi gökyüzünde kilometrelerce süzülerek uçar"
        }
      }
    }
  },

  iron_ship: {
    state: `Fizik deneyi yapılıyor:
- 10 kg ağırlığında som, katı bir demir gülle derin bir göle bırakılıyor.
- Yanında ise tamamen demir ve çelik saclardan imal edilmiş, içi boşluklu 50.000 tonluk dev bir kargo gemisi denizde yüzdürülüyor.`,
    questions: {
      "demir_gulle_batar_mi": {
        type: "noul",
        instructions: "10 kiloluk katı demir gülle suyun dibine batar mı?",
        criteria: {
          "true": "Evet, yoğunluğu sudan yüksek olduğu için dibe batar",
          "false": "Hayır, suyun yüzeyinde kalır"
        }
      },
      "demir_gemi_batar_mi": {
        type: "noul",
        instructions: "Demirden yapılmış dev kargo gemisi suyun dibine batar mı?",
        criteria: {
          "true": "Evet, demirden yapıldığı için batar",
          "false": "Hayır, kaldırma kuvveti sayesinde batmaz ve su üstünde yüzer"
        }
      },
      "fizik_prensibi": {
        type: "choice",
        instructions: "Geminin yüzmesini sağlayan temel fizik prensibi nedir?",
        criteria: {
          "arsimet_kaldirma": "Arşimet suyun kaldırma kuvveti ve ortalama yoğunluğun sudan az olması",
          "manyetik_itme": "Manyetik alanın metali itmesi",
          "yuzey_gerilimi": "Sadece su yüzey gerilimi"
        }
      }
    }
  },

  giraffe_penguin: {
    state: `DİKKAT (ÖZEL EVREN KURALI):
Bu fantastik bilimkurgu evreninde 'Penguen' adı verilen canlı normal dünyadaki gibi değildir!
Buradaki 'Penguen':
- Boyu 5 metre uzunluğundadır ve sarı-kahverengi benekli uzun bir zürafa boynuna sahiptir.
- Sırtında 8 metrelik devasa kanatları vardır ve jet hızında gökyüzünde saatlerce süzülebilir.
- Asla suya girmez, yüksek dağ tepelerinde uçar.`,
    questions: {
      "bu_penguen_ucabilir_mi": {
        type: "noul",
        instructions: "Metinde tanımlanan bu özel evrendeki Penguen gökyüzünde uçabilir mi?",
        criteria: {
          "true": "Evet, tanıma göre 8 metrelik dev kanatlarıyla saatlerce uçar",
          "false": "Hayır, normal penguenler uçamaz"
        }
      },
      "boyun_yapisi": {
        type: "choice",
        instructions: "Bu canlı fiziki olarak kime benzemektedir?",
        criteria: {
          "zurafa_benzeri_uzun_boyun": "Zürafa gibi 5 metre boyunda ve benekli uzun boyunlu",
          "kutup_pengueni": "Normal kısa boylu kutup pengueni"
        }
      },
      "kural_onceligi": {
        type: "choice",
        instructions: "Jev hangi bilgiyi önceliklendirmelidir?",
        criteria: {
          "metindeki_tanim": "Metinde (state) açıkça verilen kurgusal tanım",
          "gercek_dunya_ezberi": "Gerçek dünyadaki klasik biyoloji bilgisi"
        }
      }
    }
  },

  support_router: {
    state: `Müşteri Mesajı: "3 gündür ödeme sistemine bağlanamıyorum ve müşterilerime satış yapamıyorum! Acil teknik destek verin, her saat binlerce lira zarar ediyorum, böyle rezalet olmaz!"`,
    questions: {
      "hedef_departman": {
        type: "choice",
        instructions: "Bu mesaj şirketteki hangi departmana yönlendirilmeli?",
        criteria: {
          "teknik_destek": "Entegrasyon hataları, sistem çökmesi ve API sorunları",
          "muhasebe_fatura": "Fatura kesimi, vergi ve iade talepleri",
          "pazarlama_satis": "Yeni ürün satın alma ve fiyat teklifleri"
        }
      },
      "aciliyet_durumu": {
        type: "noul",
        instructions: "Bu mesaj zaman açısından kritik ve acil bir duruma mı işaret ediyor?",
        criteria: {
          "true": "Müşteri satış kaybettiğini ve acil müdahale gerektiğini belirtiyor",
          "false": "Sıradan, bekleyebilir bir soru"
        }
      },
      "ofke_skoru": {
        type: "score",
        instructions: "Müşterinin öfke ve hayal kırıklığı seviyesi nedir?",
        criteria: [
          "Sakin ve nötr",
          "Biraz rahatsız ama kibar",
          "Çok öfkeli, sert dilli ve sabırsız"
        ]
      }
    }
  }
};

// Application State
let currentQuestions = JSON.parse(JSON.stringify(PRESETS.birds.questions));
let currentTab = 'visual';

// Elements
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleKeyBtn = document.getElementById('toggleKeyVisibility');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const stateInput = document.getElementById('stateInput');
const questionsContainer = document.getElementById('questionsContainer');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const runBtn = document.getElementById('runBtn');
const resetBtn = document.getElementById('resetBtn');

// Tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Visual Containers
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const resultsContainer = document.getElementById('resultsContainer');
const rawRequestJson = document.getElementById('rawRequestJson');
const rawResponseJson = document.getElementById('rawResponseJson');
const codeSnippetJs = document.getElementById('codeSnippetJs');
const codeSnippetPy = document.getElementById('codeSnippetPy');
const latencyBadge = document.getElementById('latencyBadge');
const tokenBadge = document.getElementById('tokenBadge');

// Init
window.addEventListener('DOMContentLoaded', () => {
  // Load saved API Key
  const savedKey = localStorage.getItem('typesafe_api_key') || '';
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }

  // Load initial preset
  loadPreset('birds');

  setupEventListeners();
});

function setupEventListeners() {
  // Toggle Key Visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '👁️';
    }
  });

  // Save Key
  saveKeyBtn.addEventListener('click', () => {
    localStorage.setItem('typesafe_api_key', apiKeyInput.value.trim());
    saveKeyBtn.textContent = '✓ Kaydedildi';
    setTimeout(() => {
      saveKeyBtn.textContent = 'Kaydet';
    }, 2000);
  });

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const presetId = btn.getAttribute('data-preset');
      loadPreset(presetId);
    });
  });

  // Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`).classList.add('active');
      currentTab = tabId;
    });
  });

  // Add Question
  addQuestionBtn.addEventListener('click', () => {
    const qId = 'soru_' + (Object.keys(currentQuestions).length + 1);
    currentQuestions[qId] = {
      type: 'noul',
      instructions: 'Yeni soru talimatı...'
    };
    renderQuestions();
    updateCodeSnippets();
  });

  // Run
  runBtn.addEventListener('click', evaluateWithJev);

  // Reset
  resetBtn.addEventListener('click', () => {
    loadPreset('birds');
  });

  // Copy Buttons
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const text = document.getElementById(targetId).textContent;
      navigator.clipboard.writeText(text);
      const originalText = btn.textContent;
      btn.textContent = '✓ Kopyalandı';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  });

  // Dynamic code update on text change
  stateInput.addEventListener('input', updateCodeSnippets);
}

function loadPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  stateInput.value = preset.state;
  currentQuestions = JSON.parse(JSON.stringify(preset.questions));
  renderQuestions();
  updateCodeSnippets();

  // Reset visual state
  resultsContainer.style.display = 'none';
  errorState.style.display = 'none';
  emptyState.style.display = 'block';
  latencyBadge.style.display = 'none';
  tokenBadge.style.display = 'none';
}

function renderQuestions() {
  questionsContainer.innerHTML = '';

  Object.entries(currentQuestions).forEach(([qId, qObj]) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    const typeBadgeClass = qObj.type === 'noul' ? 'noul' : qObj.type === 'choice' ? 'choice' : 'score';

    card.innerHTML = `
      <div class="question-card-top">
        <div class="question-meta">
          <span class="type-badge ${typeBadgeClass}">${qObj.type.toUpperCase()}</span>
          <input type="text" class="question-id-input" value="${qId}" title="Soru Tanımlayıcısı (ID)">
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <select class="type-select">
            <option value="noul" ${qObj.type === 'noul' ? 'selected' : ''}>Noul (Evet/Hayır)</option>
            <option value="choice" ${qObj.type === 'choice' ? 'selected' : ''}>Choice (Seçenekler)</option>
            <option value="score" ${qObj.type === 'score' ? 'selected' : ''}>Score (Dereceli)</option>
          </select>
          <button class="icon-btn delete-q-btn" title="Soruyu Sil">✕</button>
        </div>
      </div>

      <div class="form-group">
        <label>Talimat (Instructions):</label>
        <textarea class="q-instructions-input" rows="2">${typeof qObj.instructions === 'string' ? qObj.instructions : JSON.stringify(qObj.instructions)}</textarea>
      </div>

      <div class="question-criteria-box">
        <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem;">Kriterler (Criteria JSON):</label>
        <textarea class="q-criteria-input" rows="3" style="font-family: var(--font-mono); font-size: 0.75rem; width: 100%;">${JSON.stringify(qObj.criteria || (qObj.type === 'score' ? ["Seviye 1", "Seviye 2"] : {}), null, 2)}</textarea>
      </div>
    `;

    // Listeners for question changes
    const idInput = card.querySelector('.question-id-input');
    const typeSelect = card.querySelector('.type-select');
    const instInput = card.querySelector('.q-instructions-input');
    const critInput = card.querySelector('.q-criteria-input');
    const delBtn = card.querySelector('.delete-q-btn');

    idInput.addEventListener('change', (e) => {
      const newId = e.target.value.trim().replace(/\s+/g, '_');
      if (newId && newId !== qId) {
        currentQuestions[newId] = currentQuestions[qId];
        delete currentQuestions[qId];
        renderQuestions();
        updateCodeSnippets();
      }
    });

    typeSelect.addEventListener('change', (e) => {
      const newType = e.target.value;
      currentQuestions[qId].type = newType;
      if (newType === 'noul') {
        currentQuestions[qId].criteria = { "true": "Evet açıklaması", "false": "Hayır açıklaması" };
      } else if (newType === 'choice') {
        currentQuestions[qId].criteria = { "secenek_a": "Açıklama A", "secenek_b": "Açıklama B" };
      } else if (newType === 'score') {
        currentQuestions[qId].criteria = ["Düşük", "Orta", "Yüksek"];
      }
      renderQuestions();
      updateCodeSnippets();
    });

    instInput.addEventListener('input', (e) => {
      currentQuestions[qId].instructions = e.target.value;
      updateCodeSnippets();
    });

    critInput.addEventListener('change', (e) => {
      try {
        currentQuestions[qId].criteria = JSON.parse(e.target.value);
        critInput.style.borderColor = 'var(--border-color)';
        updateCodeSnippets();
      } catch (err) {
        critInput.style.borderColor = 'var(--accent-rose)';
      }
    });

    delBtn.addEventListener('click', () => {
      delete currentQuestions[qId];
      renderQuestions();
      updateCodeSnippets();
    });

    questionsContainer.appendChild(card);
  });
}

function updateCodeSnippets() {
  const stateVal = stateInput.value;
  const payload = {
    state: stateVal,
    model: "jev-latest",
    questions: currentQuestions
  };

  rawRequestJson.textContent = JSON.stringify(payload, null, 2);

  // JavaScript / TypeScript Code
  codeSnippetJs.textContent = `// ⚡ TypeSafe Jev ile Sistem 1 Kararı Alma
import { TypeSafeClient } from 'typesafe-ai';

const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY
});

async function main() {
  const result = await client.evaluate({
    state: ${JSON.stringify(stateVal)},
    model: 'jev-latest',
    questions: ${JSON.stringify(currentQuestions, null, 2).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n')}
  });

  console.log("Cevaplar:", result.answers);

  // Doğrudan kodunda if / switch gibi kullan:
  ${generateCodeLogicExample(currentQuestions)}
}

main();`;

  // Python Code
  codeSnippetPy.textContent = `# ⚡ TypeSafe Jev ile Sistem 1 Kararı Alma
from typesafe import TypeSafeClient
import os

client = TypeSafeClient(api_key=os.environ.get("TYPESAFE_API_KEY"))

response = client.evaluate(
    state=${JSON.stringify(stateVal)},
    model="jev-latest",
    questions=${JSON.stringify(currentQuestions, null, 2).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n')}
)

answers = response.answers
print("Cevaplar:", answers)
`;
}

function generateCodeLogicExample(questions) {
  const firstQ = Object.entries(questions)[0];
  if (!firstQ) return '';
  const [qId, qObj] = firstQ;
  if (qObj.type === 'noul') {
    return `if (result.answers['${qId}'].noul > 0.8) {
    console.log("Koşul sağlandı (Yüksek olasılıkla EVET)!");
  } else {
    console.log("Koşul sağlanmadı (HAYIR)!");
  }`;
  } else if (qObj.type === 'choice') {
    return `const secilen = result.answers['${qId}'].choice;
  console.log("Seçilen aksiyon:", secilen);
  if (result.answers['${qId}'].confidence > 0.7) {
    // Model kararından emin, aksiyonu hemen uygula
  }`;
  } else {
    return `const puan = result.answers['${qId}'].score;
  console.log("Hesaplanan seviye puanı:", puan);`;
  }
}

async function evaluateWithJev() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Lütfen sağ üstteki alana TypeSafe API anahtarınızı (API Key) girin!');
    apiKeyInput.focus();
    return;
  }

  // Save to localStorage automatically
  localStorage.setItem('typesafe_api_key', apiKey);

  // Prepare UI
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  resultsContainer.style.display = 'none';
  loadingState.style.display = 'block';
  runBtn.disabled = true;
  runBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;margin:0 6px 0 0;display:inline-block;vertical-align:middle;border-width:2px;"></span> Hesaplanıyor...';

  const payload = {
    state: stateInput.value,
    model: 'jev-latest',
    questions: currentQuestions
  };

  rawRequestJson.textContent = JSON.stringify(payload, null, 2);

  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Jevis-Token': JEVIS_TOKEN
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    loadingState.style.display = 'none';
    runBtn.disabled = false;
    runBtn.innerHTML = '<span class="btn-icon">⚡</span> Jev\'e Değerlendir (Çalıştır)';

    rawResponseJson.textContent = JSON.stringify(data, null, 2);

    if (!res.ok || data.error) {
      errorState.style.display = 'flex';
      document.getElementById('errorTitle').textContent = `Hata (${data.status || res.status})`;
      errorMessage.textContent = data.error || (data.details && JSON.stringify(data.details)) || 'API çağrısı başarısız oldu.';
      return;
    }

    // Success: Render Visual Dashboard
    renderResults(data);

    if (data._client_latency_ms) {
      latencyBadge.textContent = `⏱️ ${data._client_latency_ms}ms`;
      latencyBadge.style.display = 'inline-block';
    }

    if (data.usage) {
      tokenBadge.textContent = `🎟️ ${data.usage.input_tokens + data.usage.output_tokens} token`;
      tokenBadge.style.display = 'inline-block';
    }

  } catch (err) {
    loadingState.style.display = 'none';
    runBtn.disabled = false;
    runBtn.innerHTML = '<span class="btn-icon">⚡</span> Jev\'e Değerlendir (Çalıştır)';
    errorState.style.display = 'flex';
    document.getElementById('errorTitle').textContent = 'Bağlantı Hatası';
    errorMessage.textContent = err.message;
  }
}

function renderResults(data) {
  resultsContainer.innerHTML = '';
  resultsContainer.style.display = 'flex';

  const answers = data.answers || {};

  Object.entries(answers).forEach(([qId, answer]) => {
    const qDefinition = currentQuestions[qId] || {};
    const card = document.createElement('div');
    card.className = 'result-card';

    if (answer.type === 'noul') {
      const prob = answer.noul;
      const pct = Math.round(prob * 100);
      const isYes = prob >= 0.5;
      const meterClass = prob > 0.65 ? 'high' : prob < 0.35 ? 'low' : 'mid';

      card.innerHTML = `
        <div class="result-card-header">
          <div class="result-title">
            <h4>${qId}</h4>
            <div class="result-inst">${typeof qDefinition.instructions === 'string' ? qDefinition.instructions : ''}</div>
          </div>
          <span class="type-badge noul">NOUL (EVET/HAYIR)</span>
        </div>

        <div class="noul-meter">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 1.1rem; color: ${isYes ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
              ${isYes ? '✓ EVET' : '✕ HAYIR'}
            </strong>
            <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700;">
              Olasılık: %${pct} (${prob.toFixed(3)})
            </span>
          </div>

          <div class="meter-track">
            <div class="meter-fill ${meterClass}" style="width: ${Math.max(pct, 5)}%;">
              %${pct}
            </div>
          </div>
          <div class="meter-labels">
            <span>0.0 (Kesinlikle Hayır)</span>
            <span>0.5 (Eşit Belirsizlik)</span>
            <span>1.0 (Kesinlikle Evet)</span>
          </div>
        </div>
      `;
    } else if (answer.type === 'choice') {
      const winner = answer.choice;
      const confPct = Math.round((answer.confidence || 0) * 100);
      const probs = answer.probabilities || {};

      let optionsHtml = '';
      Object.entries(probs).forEach(([opt, pVal]) => {
        const pPct = Math.round(pVal * 100);
        const isWinner = opt === winner;

        optionsHtml += `
          <div class="choice-option-row ${isWinner ? 'winner' : ''}">
            <div class="choice-meta">
              <span>${isWinner ? '👑 ' : ''}<strong>${opt}</strong></span>
              <span style="font-family: var(--font-mono); font-weight: 600;">%${pPct}</span>
            </div>
            <div class="choice-bar-bg">
              <div class="choice-bar-fill" style="width: ${pPct}%;"></div>
            </div>
          </div>
        `;
      });

      card.innerHTML = `
        <div class="result-card-header">
          <div class="result-title">
            <h4>${qId}</h4>
            <div class="result-inst">${typeof qDefinition.instructions === 'string' ? qDefinition.instructions : ''}</div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <span class="stat-pill" title="Model Güven Skoru">Güven: %${confPct}</span>
            <span class="type-badge choice">CHOICE</span>
          </div>
        </div>

        <div style="background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.2); padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); margin-bottom: 0.5rem;">
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Seçilen En Yüksek İhtimal:</span>
          <strong style="color: var(--accent-cyan); font-size: 1.05rem;">${winner}</strong>
        </div>

        <div class="choice-distribution">
          ${optionsHtml}
        </div>
      `;
    } else if (answer.type === 'score') {
      const scoreVal = answer.score;
      const confPct = Math.round((answer.confidence || 0) * 100);
      const criteriaList = Array.isArray(qDefinition.criteria) ? qDefinition.criteria : [];

      let levelsHtml = '';
      criteriaList.forEach((lvl, idx) => {
        const isActive = Math.round(scoreVal) === idx;
        levelsHtml += `
          <div class="score-level-pill ${isActive ? 'active' : ''}">
            ${idx}: ${typeof lvl === 'string' ? lvl : JSON.stringify(lvl)}
          </div>
        `;
      });

      card.innerHTML = `
        <div class="result-card-header">
          <div class="result-title">
            <h4>${qId}</h4>
            <div class="result-inst">${typeof qDefinition.instructions === 'string' ? qDefinition.instructions : ''}</div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <span class="stat-pill" title="Model Güven Skoru">Güven: %${confPct}</span>
            <span class="type-badge score">SCORE</span>
          </div>
        </div>

        <div class="score-scale">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">Ağırlıklı Seviye Skoru:</span>
            <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: var(--accent-purple);">
              ${scoreVal.toFixed(2)}
            </strong>
          </div>
          <div class="score-level-badges">
            ${levelsHtml}
          </div>
        </div>
      `;
    }

    resultsContainer.appendChild(card);
  });
}

/* =========================================================
   JEVIS: sohbet, canlı eylem akışı, beyin seçimi
   ========================================================= */

const modeJevisBtn = document.getElementById('modeJevisBtn');
const modePlaygroundBtn = document.getElementById('modePlaygroundBtn');
const jevisView = document.getElementById('jevisView');
const playgroundView = document.getElementById('playgroundView');

function showMode(mode) {
  const isJevis = mode === 'jevis';
  modeJevisBtn.classList.toggle('active', isJevis);
  modePlaygroundBtn.classList.toggle('active', !isJevis);
  jevisView.classList.toggle('active', isJevis);
  playgroundView.classList.toggle('active', !isJevis);
}
modeJevisBtn.addEventListener('click', () => showMode('jevis'));
modePlaygroundBtn.addEventListener('click', () => showMode('playground'));

const api = (path, options = {}) => fetch(path, {
  ...options,
  headers: { 'Content-Type': 'application/json', 'X-Jevis-Token': JEVIS_TOKEN, ...(options.headers || {}) }
});

const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const brainSelect = document.getElementById('brainSelect');
const fastToggle = document.getElementById('fastToggle');
const runStatus = document.getElementById('runStatus');
const newChatBtn = document.getElementById('newChatBtn');

let sessionId = null;
let sessionBrain = null;
let running = false;
let turnBox = null;
let pendingCards = [];
let lastText = '';

const ROUTE_NAMES = { system_quick: 'sistem komutu', page_click: 'sayfada tıklama' };
const TOOL_ICONS = { browser: '🌐', desktop: '🖥️', mac: '🍎', jev: '⚡', wait: '⏳' };

// Everything shown here may come from web pages or tools: always textContent, never innerHTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const toolIcon = name => TOOL_ICONS[String(name).split(/[_:]/)[0]] || '🔧';
const firstLines = (text, n) => String(text || '').split('\n').filter(Boolean).slice(0, n).join(' / ').slice(0, 320);

function argSummary(args) {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args)
    .filter(([k, v]) => v !== undefined && v !== '' && !['state', 'questions'].includes(k))
    .map(([, v]) => (typeof v === 'string' ? `"${v.length > 70 ? `${v.slice(0, 67)}…` : v}"` : JSON.stringify(v)))
    .join(' · ');
}

function scrollChat() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function addBubble(role, text) {
  const bubble = el('div', `chat-bubble ${role}`, text);
  chatLog.appendChild(bubble);
  scrollChat();
  return bubble;
}

function toolCard(name) {
  const card = el('div', 'step-card running');
  card.appendChild(el('span', 'step-icon', toolIcon(name)));
  const body = el('div', 'step-body');
  body.appendChild(el('div', 'step-title', name));
  card.appendChild(body);
  turnBox.appendChild(card);
  return card;
}

function renderEvent(ev) {
  switch (ev.type) {
    case 'route': {
      const fast = ev.route !== 'needs_brain';
      turnBox.appendChild(el('div', 'step-pill', fast
        ? `⚡ Hızlı yol: ${ROUTE_NAMES[ev.route] || ev.route} (Jev %${ev.confidence}, ${ev.ms} ms)`
        : `🧠 Beyne gidiyor (Jev bu işi beyin gerektiren iş saydı, %${ev.confidence})`));
      break;
    }
    case 'status':
      turnBox.appendChild(el('div', 'step-pill muted', ev.text));
      break;
    case 'tool': {
      const card = toolCard(ev.name);
      card.querySelector('.step-body').appendChild(el('div', 'step-args', argSummary(ev.args)));
      pendingCards.push({ name: ev.name, card });
      break;
    }
    case 'tool_result': {
      const i = pendingCards.findIndex(p => p.name === ev.name);
      const card = i >= 0 ? pendingCards.splice(i, 1)[0].card : toolCard(ev.name);
      card.classList.remove('running');
      card.classList.add(ev.isError ? 'error' : 'ok');
      const body = card.querySelector('.step-body');
      body.appendChild(el('div', 'step-result', firstLines(ev.text, 3)));
      if (ev.image?.data) {
        const img = el('img', 'step-thumb');
        img.src = `data:${ev.image.mimeType || 'image/jpeg'};base64,${ev.image.data}`;
        img.alt = 'ekran görüntüsü';
        body.appendChild(img);
      }
      break;
    }
    case 'text':
      addBubble('assistant', ev.text);
      lastText = ev.text;
      break;
    case 'done': {
      if (ev.text && ev.text !== lastText) addBubble('assistant', ev.text);
      if (ev.sessionId) {
        sessionId = ev.sessionId;
        sessionBrain = ev.brain;
      }
      const secs = ((ev.ms || 0) / 1000).toFixed(1);
      turnBox.appendChild(el('div', 'step-pill muted', `${ev.stopped ? '⛔ Durduruldu' : '✅ Bitti'} · ${secs} sn${ev.fast ? ' · beyin kullanılmadı' : ''}`));
      document.dispatchEvent(new CustomEvent('jevis:done', { detail: ev }));
      break;
    }
    case 'error':
      addBubble('error', `❌ ${ev.message}`);
      break;
  }
  scrollChat();
}

function setRunning(on) {
  running = on;
  sendBtn.hidden = on;
  stopBtn.hidden = !on;
  chatInput.disabled = on;
  runStatus.textContent = on ? 'Çalışıyor…' : 'Hazır';
  runStatus.classList.toggle('busy', on);
  if (!on) chatInput.focus();
}

async function sendCommand(text) {
  text = text.trim();
  if (running || !text) return;
  document.getElementById('chatWelcome')?.remove();
  addBubble('user', text);
  turnBox = el('div', 'turn-steps');
  chatLog.appendChild(turnBox);
  pendingCards = [];
  lastText = '';
  if (sessionBrain && sessionBrain !== brainSelect.value) sessionId = null;
  setRunning(true);
  try {
    const res = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({ text, brain: brainSelect.value, sessionId, fast: fastToggle.checked })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      renderEvent({ type: 'error', message: err.error || `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) renderEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    renderEvent({ type: 'error', message: err.message });
  } finally {
    setRunning(false);
  }
}

async function loadBrains() {
  const data = await (await api('/api/brains')).json();
  brainSelect.replaceChildren();
  let saved = null;
  try { saved = localStorage.getItem('jevis_brain'); } catch {}
  for (const b of data.brains) {
    const option = el('option', null, b.available ? b.label : `${b.label} — ${b.reason}`);
    option.value = b.id;
    option.disabled = !b.available;
    brainSelect.appendChild(option);
  }
  const usable = id => data.brains.some(b => b.id === id && b.available);
  brainSelect.value = usable(saved) ? saved : data.default;
}

brainSelect.addEventListener('change', () => {
  try { localStorage.setItem('jevis_brain', brainSelect.value); } catch {}
  sessionId = null;
});

sendBtn.addEventListener('click', () => {
  const text = chatInput.value;
  chatInput.value = '';
  sendCommand(text);
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendBtn.click();
  }
});

stopBtn.addEventListener('click', async () => {
  runStatus.textContent = 'Durduruluyor…';
  await api('/api/stop', { method: 'POST' });
});

newChatBtn.addEventListener('click', () => {
  sessionId = null;
  sessionBrain = null;
  chatLog.replaceChildren(el('div', 'step-pill muted', 'Yeni sohbet başladı.'));
});

document.querySelectorAll('.chip-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => sendCommand(btn.dataset.cmd));
});

loadBrains().catch(err => addBubble('error', `Beyinler yüklenemedi: ${err.message}`));
