// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Secrets live in the macOS Keychain (service "jevis"). Handry reads them only
// to type them into a field: the value is never returned to the brain or
// written to logs. Each secret lists the sites it may be typed on, so a fake
// page (or injected instructions) can't make Handry type it elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME } from '../core/config.js';
import { T } from '../core/i18n.js';

const execFileAsync = promisify(execFile);
const SERVICE = 'jevis';
const INDEX = path.join(HOME, 'secrets.json');

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf-8')); } catch { return {}; }
}

function writeIndex(index) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2), { mode: 0o600 });
}

const cleanSites = sites => sites.map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);

/**
 * Asks for the value on the terminal (via `security`, so it never appears in
 * a process list or shell history) and remembers which sites may use it.
 */
export function addSecretInteractive(name, sites) {
  const res = spawnSync('security', ['add-generic-password', '-a', name, '-s', SERVICE, '-U', '-w'], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(T('Anahtar Zinciri kaydı başarısız oldu.', 'Saving to the Keychain failed.'));
  registerSecret(name, sites);
}

/**
 * Stores a value (e.g. an API key read from a page) in the Keychain. It goes
 * to `security` on its standard input, never as an argument a process list shows.
 */
export function storeSecret(name, value, sites = []) {
  // A multi-line value (recovery codes) becomes one line: security's interactive command ends at a newline.
  const oneLine = String(value).split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(' ');
  const quoted = oneLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const res = spawnSync('security', ['-i'], { input: `add-generic-password -a "${name}" -s ${SERVICE} -U -w "${quoted}"\n`, encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`${T("Anahtar Zinciri'ne yazılamadı", "Couldn't write to the Keychain")}: ${(res.stderr || '').trim()}`);
  registerSecret(name, sites);
}

/** Records the allowed sites of a secret that is already in the Keychain. */
export function registerSecret(name, sites) {
  const index = readIndex();
  index[name] = { sites: cleanSites(sites), added: new Date().toISOString() };
  writeIndex(index);
}

export async function removeSecret(name) {
  await execFileAsync('security', ['delete-generic-password', '-a', name, '-s', SERVICE]).catch(() => {});
  const index = readIndex();
  delete index[name];
  writeIndex(index);
}

export function listSecrets() {
  return Object.entries(readIndex()).map(([name, info]) => ({ name, sites: info.sites }));
}

/** host "idmsa.apple.com" matches site "apple.com" (subdomain) and "idmsa.apple.com" (exact). */
export function siteAllowed(name, host) {
  const info = readIndex()[name];
  if (!info) return { ok: false, reason: T(`"${name}" adında kayıtlı bir sır yok. Kaydetmek için: node cli.js secret add ${name} --site <site>`, `No saved secret named "${name}". To save one: node cli.js secret add ${name} --site <site>`) };
  const h = String(host).toLowerCase();
  const ok = info.sites.some(s => h === s || h.endsWith(`.${s}`));
  if (ok) return { ok: true };
  return { ok: false, reason: T(`"${name}" sadece şu sitelerde kullanılabilir: ${info.sites.join(', ') || '(hiçbiri)'}. Şu anki site: ${h || '(yerel dosya)'}`,
    `"${name}" can only be used on these sites: ${info.sites.join(', ') || '(none)'}. This site: ${h || '(a local file)'}`) };
}

/** Reads the value. Only guard code may call this; never pass the result to an LLM. */
export async function readSecret(name) {
  const { stdout } = await execFileAsync('security', ['find-generic-password', '-a', name, '-s', SERVICE, '-w']);
  return stdout.replace(/\n$/, '');
}
