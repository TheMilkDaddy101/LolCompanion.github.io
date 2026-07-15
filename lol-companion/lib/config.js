// Persistent app configuration stored next to the server in config.json
// (gitignored — your Riot API key never leaves your machine).
import fs from 'node:fs';
import path from 'node:path';
import { appDir, dataDir, fallbackDir } from './paths.js';

// Config is written to the data dir, but read from wherever it exists —
// covers moving the exe or a location becoming unwritable later.
function configReadCandidates() {
  return [...new Set([path.join(dataDir(), 'config.json'), path.join(appDir(), 'config.json'), path.join(fallbackDir(), 'config.json')])];
}

export function configPath() {
  return path.join(dataDir(), 'config.json');
}

const DEFAULTS = {
  riotApiKey: '',
  platform: 'na1',   // na1, euw1, kr, ...
  riotId: '',        // your own "GameName#TAG" — used for recommendations & live fallback
  leaguePath: ''     // optional: League install dir if auto-detection fails
};

let cached = null;

export function getConfig() {
  if (cached) return cached;
  for (const file of configReadCandidates()) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      cached = { ...DEFAULTS, ...raw };
      return cached;
    } catch {
      // try next location
    }
  }
  cached = { ...DEFAULTS };
  return cached;
}

export function saveConfig(patch) {
  const next = { ...getConfig() };
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] !== undefined && typeof patch[key] === 'string') {
      next[key] = patch[key].trim();
    }
  }
  try {
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  } catch (e) {
    const err = new Error(
      `Could not write settings to ${configPath()} (${e.code || e.message}). ` +
      'Try moving the app to its own folder, e.g. C:\\LoLCompanion.'
    );
    err.status = 500;
    throw err;
  }
  cached = next;
  return next;
}

// What we expose to the browser: never the raw key.
export function publicConfig() {
  const cfg = getConfig();
  return {
    platform: cfg.platform,
    riotId: cfg.riotId,
    leaguePath: cfg.leaguePath,
    hasApiKey: Boolean(cfg.riotApiKey),
    configPath: configPath()
  };
}
