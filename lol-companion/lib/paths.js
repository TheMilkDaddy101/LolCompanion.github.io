// Where the app lives on disk — and where config.json and cache/ go.
// When packaged as a single executable, the build entry sets
// globalThis.__APP_DIR__ to the folder containing the .exe; when running
// from source it's the lol-companion project folder.
//
// Windows can block writes next to the exe (Program Files, Controlled
// Folder Access on Desktop/Documents), so data falls back to a per-user
// folder that is always writable: %APPDATA%\lol-companion (or ~/.config).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function appDir() {
  if (globalThis.__APP_DIR__) return globalThis.__APP_DIR__;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function fallbackDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'lol-companion');
}

function isWritable(dir) {
  const probe = path.join(dir, '.write-test');
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

let cachedDataDir = null;

// Directory for config + caches: next to the exe when possible, else the
// per-user fallback. Sticky for the process lifetime.
export function dataDir() {
  if (cachedDataDir) return cachedDataDir;
  const primary = appDir();
  if (isWritable(primary)) {
    cachedDataDir = primary;
  } else {
    const fb = fallbackDir();
    fs.mkdirSync(fb, { recursive: true });
    cachedDataDir = fb;
  }
  return cachedDataDir;
}
