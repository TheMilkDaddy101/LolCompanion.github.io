// Riot Games API client with:
//  - request throttling that respects dev-key rate limits (20/s, 100/2min)
//  - in-memory TTL caching for volatile data (ranks, matchlists)
//  - on-disk caching for immutable data (finished matches) so repeat
//    scouting is nearly free
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';
import { dataDir } from './paths.js';

const MATCH_CACHE_DIR = path.join(dataDir(), 'cache', 'matches');

// Platform (game server) → continental routing values.
const ACCOUNT_REGION = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  kr: 'asia', jp1: 'asia',
  sg2: 'asia', tw2: 'asia', vn2: 'asia'
};
const MATCH_REGION = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea'
};

export const PLATFORMS = Object.keys(MATCH_REGION);

// ---------------------------------------------------------------- throttle
// Conservative token windows below Riot's dev-key limits (20/1s, 100/120s).
const WINDOWS = [
  { limit: 15, ms: 1_000, stamps: [] },
  { limit: 95, ms: 120_000, stamps: [] }
];
let queue = Promise.resolve();

function waitNeeded() {
  const now = Date.now();
  let wait = 0;
  for (const w of WINDOWS) {
    w.stamps = w.stamps.filter((t) => now - t < w.ms);
    if (w.stamps.length >= w.limit) {
      wait = Math.max(wait, w.stamps[0] + w.ms - now);
    }
  }
  return wait;
}

function throttled(fn) {
  const run = queue.then(async () => {
    let wait = waitNeeded();
    while (wait > 0) {
      await new Promise((r) => setTimeout(r, wait + 20));
      wait = waitNeeded();
    }
    const now = Date.now();
    for (const w of WINDOWS) w.stamps.push(now);
  });
  queue = run.catch(() => {});
  return run.then(fn);
}

// ------------------------------------------------------------------- cache
const memCache = new Map(); // key -> { value, expires }

function memGet(key) {
  const hit = memCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  memCache.delete(key);
  return undefined;
}

function memSet(key, value, ttlMs) {
  if (memCache.size > 3000) memCache.clear(); // crude but bounded
  memCache.set(key, { value, expires: Date.now() + ttlMs });
}

// ----------------------------------------------------------------- request
async function riotFetch(host, apiPath) {
  const key = getConfig().riotApiKey;
  if (!key) {
    const err = new Error('No Riot API key configured. Add one in Settings (free at developer.riotgames.com).');
    err.status = 428;
    throw err;
  }
  const url = `https://${host}${apiPath}`;
  const res = await throttled(() => fetch(url, { headers: { 'X-Riot-Token': key } }));
  if (res.status === 429) {
    // One respectful retry after the server-instructed backoff.
    const retryAfter = Number(res.headers.get('retry-after') || 2);
    await new Promise((r) => setTimeout(r, (retryAfter + 0.5) * 1000));
    const retry = await throttled(() => fetch(url, { headers: { 'X-Riot-Token': key } }));
    if (retry.ok) return retry.json();
    const err = new Error('Riot API rate limit hit — wait a minute and try again.');
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const messages = {
      401: 'Riot API rejected the key (401). Check it in Settings.',
      403: 'Riot API key expired or invalid (403). Dev keys last 24h — regenerate at developer.riotgames.com.',
      404: 'Not found (404).'
    };
    const err = new Error(messages[res.status] || `Riot API error ${res.status} for ${apiPath}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function cachedFetch(host, apiPath, ttlMs) {
  const cacheKey = `${host}${apiPath}`;
  const hit = memGet(cacheKey);
  if (hit !== undefined) return hit;
  const value = await riotFetch(host, apiPath);
  memSet(cacheKey, value, ttlMs);
  return value;
}

// --------------------------------------------------------------- endpoints
const TTL = {
  account: 24 * 3600_000,
  league: 10 * 60_000,
  mastery: 3600_000,
  matchlist: 2 * 60_000,
  spectator: 30_000
};

// Cheapest possible authenticated call — verifies the saved key works.
export function checkKey(platform) {
  return riotFetch(`${platform}.api.riotgames.com`, '/lol/status/v4/platform-data');
}

export function accountByRiotId(riotId, platform) {
  const [name, tag] = riotId.split('#');
  if (!name || !tag) {
    const err = new Error(`"${riotId}" is not a Riot ID — use the GameName#TAG format.`);
    err.status = 400;
    throw err;
  }
  const host = `${ACCOUNT_REGION[platform] || 'americas'}.api.riotgames.com`;
  return cachedFetch(host, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, TTL.account);
}

export function accountByPuuid(puuid, platform) {
  const host = `${ACCOUNT_REGION[platform] || 'americas'}.api.riotgames.com`;
  return cachedFetch(host, `/riot/account/v1/accounts/by-puuid/${puuid}`, TTL.account);
}

export function summonerByPuuid(puuid, platform) {
  return cachedFetch(`${platform}.api.riotgames.com`, `/lol/summoner/v4/summoners/by-puuid/${puuid}`, TTL.account);
}

export function leagueEntriesByPuuid(puuid, platform) {
  return cachedFetch(`${platform}.api.riotgames.com`, `/lol/league/v4/entries/by-puuid/${puuid}`, TTL.league);
}

export function topMasteries(puuid, platform, count = 5) {
  return cachedFetch(
    `${platform}.api.riotgames.com`,
    `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`,
    TTL.mastery
  );
}

export function matchIds(puuid, platform, { start = 0, count = 10, queue = null, type = null } = {}) {
  const params = new URLSearchParams({ start: String(start), count: String(count) });
  if (queue) params.set('queue', String(queue));
  if (type) params.set('type', type);
  const host = `${MATCH_REGION[platform] || 'americas'}.api.riotgames.com`;
  return cachedFetch(host, `/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`, TTL.matchlist);
}

export async function getMatch(matchId, platform) {
  // Finished matches never change — cache them on disk forever.
  const file = path.join(MATCH_CACHE_DIR, `${matchId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // cache miss
  }
  const host = `${MATCH_REGION[platform] || 'americas'}.api.riotgames.com`;
  const match = await riotFetch(host, `/lol/match/v5/matches/${matchId}`);
  try {
    fs.mkdirSync(MATCH_CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(match));
  } catch {
    // disk cache is best-effort
  }
  return match;
}

export function activeGameByPuuid(puuid, platform) {
  return cachedFetch(
    `${platform}.api.riotgames.com`,
    `/lol/spectator/v5/active-games/by-summoner/${puuid}`,
    TTL.spectator
  );
}
