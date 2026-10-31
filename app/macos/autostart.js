// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Start Handry at login through a LaunchAgent. Off unless the user turns it on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LABEL = 'studio.purpfox.foxie';
export const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = () => `gui/${os.userInfo().uid}`;

export function plistFor(appPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>${appPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export function enableAutostart(appPath) {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plistFor(appPath));
  try { execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', domain(), PLIST], { stdio: 'pipe' });
}

export function disableAutostart() {
  try { execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' }); } catch {}
  fs.rmSync(PLIST, { force: true });
}

export const autostartEnabled = () => fs.existsSync(PLIST);
