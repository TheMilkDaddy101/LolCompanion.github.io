// Persistent app configuration stored next to the server in config.json
// (gitignored — your Riot API key never leaves your machine).
import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './paths.js';

const CONFIG_PATH = path.join(appDir(), 'config.json');

const DEFAULTS = {
  riotApiKey: '',
  platform: 'na1',   // na1, euw1, kr, ...
  riotId: '',        // your own "GameName#TAG" — used for recommendations & live fallback
  leaguePath: ''     // optional: League install dir if auto-detection fails
};

let cached = null;

export function getConfig() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cached = { ...DEFAULTS, ...raw };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

export function saveConfig(patch) {
  const next = { ...getConfig() };
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] !== undefined && typeof patch[key] === 'string') {
      next[key] = patch[key].trim();
    }
  }
  cached = next;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

// What we expose to the browser: never the raw key.
export function publicConfig() {
  const cfg = getConfig();
  return {
    platform: cfg.platform,
    riotId: cfg.riotId,
    leaguePath: cfg.leaguePath,
    hasApiKey: Boolean(cfg.riotApiKey)
  };
}
