#!/usr/bin/env node
// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Scans a mobile app's source for SDKs and permissions and drafts the App
// Store "App Privacy" answers. Deterministic: no LLM, nothing leaves the Mac.
// Usage: node appstore/privacy-scan.js <app-folder> [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SDK → data Apple asks about. Categories follow App Store Connect's App
// Privacy form. Every line is a draft for the user to confirm.
const SDKS = [
  { id: 'Firebase Analytics', match: [/FirebaseAnalytics/, /@react-native-firebase\/analytics/, /firebase_analytics/], data: [['Usage Data', 'Product Interaction', 'Analytics'], ['Identifiers', 'Device ID', 'Analytics']] },
  { id: 'Firebase Crashlytics', match: [/FirebaseCrashlytics/, /@react-native-firebase\/crashlytics/, /firebase_crashlytics/], data: [['Diagnostics', 'Crash Data', 'App Functionality'], ['Diagnostics', 'Performance Data', 'App Functionality']] },
  { id: 'Firebase Auth', match: [/FirebaseAuth/, /@react-native-firebase\/auth/, /firebase_auth/], data: [['Contact Info', 'Email Address', 'App Functionality'], ['Identifiers', 'User ID', 'App Functionality']] },
  { id: 'Firebase Messaging (push)', match: [/FirebaseMessaging/, /@react-native-firebase\/messaging/, /firebase_messaging/], data: [['Identifiers', 'Device ID', 'App Functionality']] },
  { id: 'Sentry', match: [/pod ['"]Sentry/, /sentry-cocoa/, /@sentry\//, /sentry_flutter/], data: [['Diagnostics', 'Crash Data', 'App Functionality'], ['Diagnostics', 'Performance Data', 'App Functionality']] },
  { id: 'Google Mobile Ads (AdMob)', match: [/Google-Mobile-Ads-SDK/, /GoogleMobileAds/, /react-native-google-mobile-ads/, /google_mobile_ads/], tracking: true, data: [['Identifiers', 'Device ID', 'Third-Party Advertising'], ['Usage Data', 'Advertising Data', 'Third-Party Advertising'], ['Location', 'Coarse Location', 'Third-Party Advertising']] },
  { id: 'AppLovin / Unity Ads / IronSource', match: [/AppLovinSDK/, /UnityAds/, /IronSource/, /applovin/, /unity_ads/], tracking: true, data: [['Identifiers', 'Device ID', 'Third-Party Advertising'], ['Usage Data', 'Advertising Data', 'Third-Party Advertising']] },
  { id: 'Facebook SDK', match: [/FBSDKCoreKit/, /FacebookCore/, /react-native-fbsdk/, /flutter_facebook/], tracking: true, data: [['Identifiers', 'Device ID', 'Third-Party Advertising'], ['Usage Data', 'Product Interaction', 'Analytics']] },
  { id: 'AppsFlyer / Adjust / Branch (attribution)', match: [/AppsFlyer/, /pod ['"]Adjust/, /adjust-ios-sdk/, /react-native-adjust/, /adjust_sdk/, /pod ['"]Branch/, /ios-branch-deep-linking/, /react-native-branch/, /flutter_branch_sdk/], tracking: true, data: [['Identifiers', 'Device ID', 'Third-Party Advertising'], ['Usage Data', 'Product Interaction', 'Analytics']] },
  { id: 'Mixpanel / Amplitude / Segment / PostHog', match: [/mixpanel/i, /amplitude/i, /@segment\//, /analytics-swift/, /segment_analytics/, /posthog/i], data: [['Usage Data', 'Product Interaction', 'Analytics'], ['Identifiers', 'User ID', 'Analytics']] },
  { id: 'RevenueCat', match: [/RevenueCat/, /react-native-purchases/, /purchases_flutter/], data: [['Purchases', 'Purchase History', 'App Functionality'], ['Identifiers', 'User ID', 'App Functionality']] },
  { id: 'OneSignal', match: [/OneSignal/i], data: [['Identifiers', 'Device ID', 'App Functionality'], ['Usage Data', 'Product Interaction', 'Analytics']] },
  { id: 'Google Sign-In', match: [/GoogleSignIn/, /google-signin/, /google_sign_in/], data: [['Contact Info', 'Name', 'App Functionality'], ['Contact Info', 'Email Address', 'App Functionality']] },
  { id: 'Sign in with Apple', match: [/com\.apple\.developer\.applesignin/, /apple-authentication/, /sign_in_with_apple/], data: [['Contact Info', 'Name', 'App Functionality'], ['Contact Info', 'Email Address', 'App Functionality']] },
  { id: 'Supabase', match: [/supabase/i], data: [['Identifiers', 'User ID', 'App Functionality']] },
  { id: 'Stripe', match: [/pod ['"]Stripe/, /stripe-ios/, /@stripe\//, /flutter_stripe/], data: [['Financial Info', 'Payment Info', 'App Functionality']] }
];

// Info.plist usage descriptions → the permission and the data it exposes.
const PERMISSIONS = {
  NSLocationWhenInUseUsageDescription: ['Konum (uygulama açıkken)', ['Location', 'Precise Location', 'App Functionality']],
  NSLocationAlwaysAndWhenInUseUsageDescription: ['Konum (her zaman)', ['Location', 'Precise Location', 'App Functionality']],
  NSCameraUsageDescription: ['Kamera', ['User Content', 'Photos or Videos', 'App Functionality']],
  NSPhotoLibraryUsageDescription: ['Fotoğraf arşivi', ['User Content', 'Photos or Videos', 'App Functionality']],
  NSMicrophoneUsageDescription: ['Mikrofon', ['User Content', 'Audio Data', 'App Functionality']],
  NSContactsUsageDescription: ['Kişiler', ['Contacts', 'Contacts', 'App Functionality']],
  NSCalendarsUsageDescription: ['Takvim', ['User Content', 'Other User Content', 'App Functionality']],
  NSHealthShareUsageDescription: ['Sağlık verisi', ['Health & Fitness', 'Health', 'App Functionality']],
  NSMotionUsageDescription: ['Hareket', ['Health & Fitness', 'Fitness', 'App Functionality']],
  NSUserTrackingUsageDescription: ['Takip izni (ATT)', null],
  NSBluetoothAlwaysUsageDescription: ['Bluetooth', null],
  NSFaceIDUsageDescription: ['Face ID', null],
  NSSpeechRecognitionUsageDescription: ['Konuşma tanıma', ['User Content', 'Audio Data', 'App Functionality']]
};

const SKIP_DIRS = new Set(['node_modules', 'Pods', '.git', 'build', 'DerivedData', '.dart_tool', 'android', '.expo', 'ios/build']);
const FILES = /^(Podfile(\.lock)?|Package\.resolved|Cartfile(\.resolved)?|package\.json|pubspec\.(yaml|lock)|Info\.plist|PrivacyInfo\.xcprivacy|app\.json|app\.config\.(js|ts)|.+\.entitlements)$/;

function collect(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) collect(full, out, depth + 1);
    } else if (FILES.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

export function scan(appDir) {
  const root = path.resolve(appDir);
  const files = collect(root);
  const sdks = new Map();
  const permissions = new Map();
  const manifestTypes = new Set();
  let platform = 'bilinmiyor';

  for (const file of files) {
    const name = path.basename(file);
    const body = fs.readFileSync(file, 'utf-8');
    if (name === 'pubspec.yaml') platform = 'Flutter';
    else if (name === 'package.json' && /react-native|expo/.test(body)) platform = /"expo"/.test(body) ? 'Expo / React Native' : 'React Native';
    else if (/^(Podfile|Package\.resolved|Cartfile)/.test(name) && platform === 'bilinmiyor') platform = 'iOS (Swift / Objective-C)';

    for (const sdk of SDKS) {
      if (sdk.match.some(re => re.test(body))) {
        if (!sdks.has(sdk.id)) sdks.set(sdk.id, { ...sdk, files: [] });
        sdks.get(sdk.id).files.push(path.relative(root, file));
      }
    }
    if (name === 'Info.plist' || /^app\.(json|config)/.test(name)) {
      for (const [key, info] of Object.entries(PERMISSIONS)) {
        if (body.includes(key)) permissions.set(key, info);
      }
    }
    if (name === 'PrivacyInfo.xcprivacy') {
      for (const m of body.matchAll(/NSPrivacyCollectedDataType(\w+)/g)) manifestTypes.add(m[1]);
    }
  }

  // Merge everything into Apple's "data type → purpose" rows.
  const rows = new Map();
  const add = (category, type, purpose, source, tracking = false) => {
    const key = `${category} › ${type}`;
    if (!rows.has(key)) rows.set(key, { category, type, purposes: new Set(), sources: new Set(), tracking: false });
    const row = rows.get(key);
    row.purposes.add(purpose);
    row.sources.add(source);
    row.tracking ||= tracking;
  };
  for (const sdk of sdks.values()) for (const [c, t, p] of sdk.data) add(c, t, p, sdk.id, Boolean(sdk.tracking));
  for (const [key, [label, data]] of permissions) if (data) add(data[0], data[1], data[2], `${label} izni (${key})`);

  return {
    root,
    platform,
    filesScanned: files.map(f => path.relative(root, f)),
    sdks: [...sdks.values()].map(s => ({ id: s.id, tracking: Boolean(s.tracking), files: s.files })),
    permissions: [...permissions].map(([key, [label]]) => ({ key, label })),
    privacyManifestTypes: [...manifestTypes],
    usesTracking: [...sdks.values()].some(s => s.tracking) || permissions.has('NSUserTrackingUsageDescription'),
    dataCollected: [...rows.values()].map(r => ({ ...r, purposes: [...r.purposes], sources: [...r.sources] }))
  };
}

export function toMarkdown(r) {
  const lines = [
    `# App Privacy taslağı — ${path.basename(r.root)}`,
    '',
    `> Koddan otomatik çıkarıldı. **Her satırı doğrula**: kodda olup kullanılmayan bir SDK veya sunucuda toplanan veriler bu taramada görünmez.`,
    '',
    `- Platform: ${r.platform}`,
    `- Taranan dosya: ${r.filesScanned.length}`,
    `- Takip (tracking): **${r.usesTracking ? 'EVET, büyük ihtimalle' : 'görünmüyor'}**${r.usesTracking ? ' — reklam/atıf SDK’sı ya da ATT izni var' : ''}`,
    '',
    '## Bulunan SDK’lar',
    ...(r.sdks.length ? r.sdks.map(s => `- ${s.id}${s.tracking ? ' (takip)' : ''} — ${s.files.join(', ')}`) : ['- (yok)']),
    '',
    '## İstenen izinler (Info.plist / app.json)',
    ...(r.permissions.length ? r.permissions.map(p => `- ${p.label} — \`${p.key}\``) : ['- (yok)']),
    ''
  ];
  if (r.privacyManifestTypes.length) lines.push('## Privacy manifest (PrivacyInfo.xcprivacy) veri türleri', ...r.privacyManifestTypes.map(t => `- ${t}`), '');
  lines.push('## Taslak cevaplar (App Store Connect › App Privacy)', '', '| Veri türü | Amaç | Kaynak | Takip |', '|---|---|---|---|');
  for (const d of r.dataCollected) lines.push(`| ${d.category} › ${d.type} | ${d.purposes.join(', ')} | ${d.sources.join(', ')} | ${d.tracking ? 'evet' : 'hayır'} |`);
  if (!r.dataCollected.length) lines.push('| — | Veri toplandığına dair iz yok. "Data Not Collected" seçilebilir, ama sunucu tarafını da düşün. | | |');
  lines.push('', 'Kullanıcıya bağlı mı (linked to user)? Giriş/hesap sistemi varsa çoğu veri **bağlıdır**; bunu sen onayla.');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.log('Kullanım: node appstore/privacy-scan.js <uygulama-klasörü> [--json]');
    process.exit(1);
  }
  const result = scan(dir);
  console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : toMarkdown(result));
}
