// CAPTCHA detection and auto-solving.
// Supported: reCAPTCHA v2, hCaptcha, Cloudflare Turnstile, FunCaptcha/Arkose, image text.
// Primary solver: 2captcha.com (CAPTCHA_KEY env var, or "2captcha-key" in Keychain, or jevis.config.json captcha.key).
// Fallback for image text only: Claude Vision (ANTHROPIC_API_KEY env var).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, config } from '../core/config.js';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

let cachedKey = null;

async function getCaptchaKey() {
  if (cachedKey) return cachedKey;

  // 1. env var
  if (process.env.CAPTCHA_KEY) { cachedKey = process.env.CAPTCHA_KEY; return cachedKey; }
  if (process.env.TWOCAPTCHA_KEY) { cachedKey = process.env.TWOCAPTCHA_KEY; return cachedKey; }

  // 2. .env file
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    const m = env.match(/(?:CAPTCHA_KEY|TWOCAPTCHA_KEY)=([^\r\n]+)/);
    if (m) { cachedKey = m[1].trim(); return cachedKey; }
  } catch {}

  // 3. jevis.config.json captcha.key
  try {
    const k = config().captcha?.key;
    if (k) { cachedKey = k; return cachedKey; }
  } catch {}

  // 4. Keychain ("2captcha-key")
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-a', '2captcha-key', '-s', 'jevis', '-w']);
    const v = stdout.trim();
    if (v) { cachedKey = v; return cachedKey; }
  } catch {}

  return null;
}

// ---------------------------------------------------------------------------
// CAPTCHA type detection
// ---------------------------------------------------------------------------

/** Returns { type, sitekey, extra } or null if no CAPTCHA found. */
export async function detect(page) {
  // Check iframes
  for (const frame of page.frames()) {
    const url = frame.url();
    if (/google\.com\/recaptcha|recaptcha\.net/i.test(url)) {
      const sitekey = new URLSearchParams(new URL(url).search).get('k') || await extractSitekey(page, '.g-recaptcha', 'g-recaptcha-response');
      return { type: 'recaptcha2', sitekey };
    }
    if (/hcaptcha\.com/i.test(url)) {
      const sitekey = await extractSitekey(page, '.h-captcha');
      return { type: 'hcaptcha', sitekey };
    }
    if (/challenges\.cloudflare\.com/i.test(url)) {
      const sitekey = await extractSitekey(page, '.cf-turnstile,[data-sitekey]');
      return { type: 'turnstile', sitekey };
    }
    if (/arkoselabs\.com|funcaptcha\.com/i.test(url)) {
      const publicKey = await page.evaluate(() => {
        const s = document.querySelector('[data-pkey]');
        return s?.dataset?.pkey || window.__FUNASSIST?.pk || null;
      }).catch(() => null);
      const apiJsSubdomain = new URL(url).hostname;
      return { type: 'funcaptcha', sitekey: publicKey, extra: { apiJsSubdomain } };
    }
  }

  // Check page HTML
  const html = await page.content().catch(() => '');

  if (/data-sitekey=["']([^"']+)["']/.test(html)) {
    const sitekey = html.match(/data-sitekey=["']([^"']+)["']/)?.[1];
    if (html.includes('g-recaptcha') || html.includes('grecaptcha')) return { type: 'recaptcha2', sitekey };
    if (html.includes('h-captcha') || html.includes('hcaptcha')) return { type: 'hcaptcha', sitekey };
    if (html.includes('cf-turnstile')) return { type: 'turnstile', sitekey };
  }

  // GitHub FunCaptcha: look for Arkose enforcement
  if (html.includes('arkoselabs') || html.includes('funcaptcha') || html.includes('data-pkey')) {
    const sitekey = html.match(/(?:data-pkey|arkose_key|public_key)=?["'\s]*([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i)?.[1];
    return { type: 'funcaptcha', sitekey };
  }

  // Simple image CAPTCHA
  const imgSrc = await page.evaluate(() => {
    const img = document.querySelector('img[src*="captcha" i], img[alt*="captcha" i], #captcha img, .captcha img, [class*="captcha" i] img');
    return img?.src || null;
  }).catch(() => null);
  if (imgSrc) return { type: 'image', imgSrc };

  return null;
}

async function extractSitekey(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el?.dataset?.sitekey || el?.getAttribute('data-sitekey') || null;
  }, selector).catch(() => null);
}

// ---------------------------------------------------------------------------
// 2captcha solver
// ---------------------------------------------------------------------------

const TWOCAPTCHA_IN = 'https://2captcha.com/in.php';
const TWOCAPTCHA_RES = 'https://2captcha.com/res.php';

async function submit2captcha(params) {
  const body = new URLSearchParams(params);
  const res = await fetch(TWOCAPTCHA_IN, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!text.startsWith('OK|')) throw new Error(`2captcha submit error: ${text}`);
  return text.slice(3);
}

async function poll2captcha(key, taskId, { maxWaitSec = 120 } = {}) {
  await sleep(15000); // initial wait — 2captcha workers need ~10-30s
  const deadline = Date.now() + maxWaitSec * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${TWOCAPTCHA_RES}?action=get&key=${key}&id=${taskId}`, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    if (text.startsWith('OK|')) return text.slice(3);
    if (text !== 'CAPCHA_NOT_READY') throw new Error(`2captcha result error: ${text}`);
    await sleep(5000);
  }
  throw new Error('2captcha timeout — CAPTCHA çözülemedi');
}

async function solve2captcha(captchaInfo, pageUrl) {
  const key = await getCaptchaKey();
  if (!key) return null;

  const { type, sitekey, extra } = captchaInfo;
  let taskId;

  if (type === 'recaptcha2') {
    if (!sitekey) throw new Error('reCAPTCHA sitekey bulunamadı');
    taskId = await submit2captcha({ key, method: 'userrecaptcha', googlekey: sitekey, pageurl: pageUrl });
  } else if (type === 'hcaptcha') {
    if (!sitekey) throw new Error('hCaptcha sitekey bulunamadı');
    taskId = await submit2captcha({ key, method: 'hcaptcha', sitekey, pageurl: pageUrl });
  } else if (type === 'turnstile') {
    if (!sitekey) throw new Error('Turnstile sitekey bulunamadı');
    taskId = await submit2captcha({ key, method: 'turnstile', sitekey, pageurl: pageUrl });
  } else if (type === 'funcaptcha') {
    if (!sitekey) throw new Error('FunCaptcha public key bulunamadı');
    const params = { key, method: 'funcaptcha', publickey: sitekey, pageurl: pageUrl };
    if (extra?.apiJsSubdomain) params.api_js_subdomain = extra.apiJsSubdomain;
    taskId = await submit2captcha(params);
  } else if (type === 'image') {
    const imgB64 = await fetchImageBase64(captchaInfo.imgSrc);
    if (!imgB64) throw new Error('CAPTCHA görseli alınamadı');
    taskId = await submit2captcha({ key, method: 'base64', body: imgB64 });
  } else {
    return null;
  }

  return poll2captcha(key, taskId, { maxWaitSec: config().captcha?.maxWaitSec ?? 120 });
}

async function fetchImageBase64(src) {
  try {
    if (src.startsWith('data:')) {
      return src.split(',')[1];
    }
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude Vision fallback (image text only, needs ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

async function solveVision(imgBase64, mimeType = 'image/png') {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const body = {
    model: 'claude-haiku-5-5',
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: [{
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: imgBase64 }
      }, {
        type: 'text',
        text: 'This is a CAPTCHA image. Read the text shown and reply with ONLY that text, nothing else.'
      }]
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

// ---------------------------------------------------------------------------
// Token injection into the page
// ---------------------------------------------------------------------------

async function inject(page, type, token) {
  if (type === 'recaptcha2') {
    await page.evaluate(t => {
      // Inject into the hidden textarea
      const areas = document.querySelectorAll('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
      areas.forEach(el => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, t);
        el.innerHTML = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Fire registered callback
      const cfg = window.___grecaptcha_cfg?.clients;
      if (cfg) {
        for (const id of Object.keys(cfg)) {
          for (const key of Object.keys(cfg[id])) {
            const v = cfg[id][key];
            if (v && typeof v === 'object' && typeof v.callback === 'function') {
              try { v.callback(t); } catch {}
            }
          }
        }
      }
    }, token);
  } else if (type === 'hcaptcha') {
    await page.evaluate(t => {
      const el = document.querySelector('textarea[name="h-captcha-response"], [name="h-captcha-response"]');
      if (el) el.value = t;
      if (window.hcaptcha?.submit) window.hcaptcha.submit();
      document.dispatchEvent(new Event('hcaptchaSuccess'));
    }, token);
  } else if (type === 'turnstile') {
    await page.evaluate(t => {
      const el = document.querySelector('[name="cf-turnstile-response"], input[name="cf-turnstile-response"]');
      if (el) el.value = t;
      // Trigger any registered callback
      if (window.turnstile?._callbacks) {
        for (const cb of Object.values(window.turnstile._callbacks)) {
          if (typeof cb === 'function') try { cb(t); } catch {}
        }
      }
    }, token);
  } else if (type === 'funcaptcha') {
    await page.evaluate(t => {
      // Inject into enforcement enforcement iframe's parent hidden input
      const el = document.querySelector('[name="fc-token"], input[id*="arkose"], input[id*="funcaptcha"]');
      if (el) { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }
      // Also try postMessage to parent
      const iframes = document.querySelectorAll('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]');
      iframes.forEach(f => { try { f.contentWindow?.postMessage({ eventId: 'challenge-complete', payload: { token: t } }, '*'); } catch {} });
    }, token);
  } else if (type === 'image') {
    // For image text CAPTCHAs, just return the text — caller types it
    return { typeText: token };
  }
  return { injected: true };
}

// ---------------------------------------------------------------------------
// Main solve entry point
// ---------------------------------------------------------------------------

/**
 * Detects and solves the CAPTCHA on `page`.
 * Returns { solved, type, method, text? } or throws on hard error.
 * Returns { solved: false, reason } if no CAPTCHA found or no solver available.
 */
export async function solve(page) {
  const info = await detect(page);
  if (!info) return { solved: false, reason: 'Sayfada CAPTCHA bulunamadı' };

  const pageUrl = page.url();
  const { type } = info;

  // Try 2captcha first
  let token = null;
  let method = null;
  let error2c = null;

  const key = await getCaptchaKey();
  if (key) {
    try {
      token = await solve2captcha(info, pageUrl);
      method = '2captcha';
    } catch (e) {
      error2c = e.message;
    }
  }

  // Fallback: Claude Vision for image text CAPTCHAs
  if (!token && type === 'image') {
    try {
      const imgB64 = await fetchImageBase64(info.imgSrc);
      if (imgB64) {
        token = await solveVision(imgB64);
        method = 'vision';
      }
    } catch {}
  }

  if (!token) {
    const reason = error2c
      ? `2captcha hatası: ${error2c}${key ? '' : '. CAPTCHA_KEY tanımlı değil.'}`
      : (key ? 'CAPTCHA çözülemedi' : 'CAPTCHA_KEY tanımlı değil. .env dosyasına CAPTCHA_KEY=<2captcha.com API anahtarı> ekleyin.');
    return { solved: false, type, reason };
  }

  // Inject the token / type the text
  const result = await inject(page, type, token);
  if (result?.typeText) {
    // Find the CAPTCHA input field and type the text
    await page.evaluate(text => {
      const el = document.querySelector('#captcha, input[name*="captcha" i], input[id*="captcha" i], .captcha input');
      if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, result.typeText);
    return { solved: true, type, method, text: token };
  }

  // Wait a moment for the page to process the token
  await sleep(1000);

  return { solved: true, type, method };
}

/**
 * Returns a human-readable description of what CAPTCHA type is on the page, or null.
 */
export async function describe(page) {
  const info = await detect(page);
  if (!info) return null;
  const names = { recaptcha2: 'Google reCAPTCHA v2', hcaptcha: 'hCaptcha', turnstile: 'Cloudflare Turnstile', funcaptcha: 'FunCaptcha/Arkose', image: 'Görsel CAPTCHA' };
  return names[info.type] || info.type;
}
