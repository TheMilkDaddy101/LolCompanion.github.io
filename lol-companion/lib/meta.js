// Meta builds & matchups, sourced from u.gg's public stats CDN — the same
// JSON files their website loads. Undocumented format, so everything here
// parses defensively: a section that doesn't match expectations is dropped
// rather than crashing, and /api/meta/raw exposes the source JSON for
// debugging if u.gg ships a format change.
//
// Data is cached on disk for 12h per champion+queue — one small fetch per
// champ per half-day keeps us a polite guest.
import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './paths.js';

const CACHE_DIR = path.join(appDir(), 'cache', 'meta');
const CACHE_TTL = 12 * 3600_000;
// Some CDNs reject obviously non-browser user agents.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const PATH_PREFIXES = ['1.5', '1.1'];
const API_VERSIONS = ['1.5.0', '1.4.0'];
// u.gg queue ids we try, in order, per friendly name.
export const QUEUES = {
  ranked_solo: ['ranked_solo_5x5'],
  ranked_flex: ['ranked_flex_sr'],
  aram: ['normal_aram', 'aram'],
  arena: ['arena_duo', 'arena', 'cherry']
};
const ROLE_IDS = { 4: 'TOP', 1: 'JUNGLE', 5: 'MID', 3: 'ADC', 2: 'SUPPORT', 6: 'NONE' };

let patchCache = { value: null, at: 0 };

export async function currentPatch() {
  if (patchCache.value && Date.now() - patchCache.at < 3600_000) return patchCache.value;
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  if (!res.ok) throw new Error('Could not fetch current patch from Data Dragon');
  const [latest] = await res.json();
  const [major, minor] = latest.split('.');
  patchCache = { value: `${major}_${minor}`, at: Date.now() };
  return patchCache.value;
}

function stepBack(patch) {
  const [major, minor] = patch.split('_').map(Number);
  return minor > 1 ? `${major}_${minor - 1}` : `${major - 1}_24`;
}

// Riot's marketing patch numbers ("26.13") diverged from Data Dragon's
// internal versions ("16.13") — major + 10. u.gg has used both styles, so
// try each, newest first.
function patchCandidates(ddPatch) {
  const [major, minor] = ddPatch.split('_').map(Number);
  const marketing = `${major + 10}_${minor}`;
  return [ddPatch, marketing, stepBack(ddPatch), stepBack(marketing)];
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://u.gg/' }
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Remember the URL shape that worked so later champions go straight there.
let workingShape = null; // { prefix, ver }
// Attempts from the most recent failed lookup, for /api/meta/diagnose.
export let lastAttempts = [];

// Try patch numbering schemes, queue-name variants, URL prefixes, and API
// versions until one URL answers. Returns { json, patch, queue } or throws
// with a summary of everything tried.
async function fetchStats(kind, championId, queueKey) {
  const queues = QUEUES[queueKey];
  if (!queues) {
    const err = new Error(`Unknown queue "${queueKey}"`);
    err.status = 400;
    throw err;
  }
  // Cache is keyed by the CURRENT patch, so the moment Riot ships a new
  // patch every cached build is stale by name and gets refetched — builds
  // track the live meta with zero manual updates.
  const patch = await currentPatch();
  const cachePrefix = `${kind}_${queueKey}_${championId}_`;
  const cacheFile = path.join(CACHE_DIR, `${cachePrefix}${patch}.json`);
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_TTL) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch {
    // cache miss
  }

  const shapes = workingShape
    ? [workingShape, ...shapeList().filter((s) => s.prefix !== workingShape.prefix || s.ver !== workingShape.ver)]
    : shapeList();
  const attempts = [];
  for (const p of patchCandidates(patch)) {
    for (const queue of queues) {
      for (const shape of shapes) {
        const url = `https://stats2.u.gg/lol/${shape.prefix}/${kind}/${p}/${queue}/${championId}/${shape.ver}.json`;
        try {
          const json = await fetchJson(url);
          workingShape = shape;
          const result = { json, patch: p, queue };
          try {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify(result));
            // Sweep this champion's entries from older patches.
            for (const f of fs.readdirSync(CACHE_DIR)) {
              if (f.startsWith(cachePrefix) && f !== path.basename(cacheFile)) {
                fs.rmSync(path.join(CACHE_DIR, f), { force: true });
              }
            }
          } catch { /* disk cache best-effort */ }
          return result;
        } catch (err) {
          attempts.push({ url, error: err.message });
        }
      }
    }
  }
  lastAttempts = attempts;
  const statuses = [...new Set(attempts.map((a) => a.error))].join(', ');
  const err = new Error(
    `Couldn't fetch ${kind} data (tried ${attempts.length} URL variants; results: ${statuses}). ` +
    'Open /api/meta/diagnose for the full list — u.gg may have moved this feed.'
  );
  err.status = 502;
  throw err;
}

function shapeList() {
  const shapes = [];
  for (const prefix of PATH_PREFIXES) {
    for (const ver of API_VERSIONS) shapes.push({ prefix, ver });
  }
  return shapes;
}

// Leaf arrays store matches and wins in an order that has drifted between
// versions. wins <= matches always, which disambiguates.
function winsMatches(a, b) {
  a = Number(a) || 0;
  b = Number(b) || 0;
  return b <= a ? { matches: a, wins: b } : { matches: b, wins: a };
}

const pct = (wins, matches) => (matches ? Math.round((1000 * wins) / matches) / 10 : null);

// Drill through { region: { tier: { role: data } } } picking World/Overall
// (region "12", tier "10") when present, else whatever exists.
export function pickRoles(json) {
  const region = json?.['12'] || Object.values(json || {})[0];
  const tier = region?.['10'] || Object.values(region || {})[0];
  if (!tier || typeof tier !== 'object') return {};
  const out = {};
  for (const [roleId, data] of Object.entries(tier)) {
    if (Array.isArray(data) && data.length) out[ROLE_IDS[roleId] || roleId] = data;
  }
  return out;
}

const SKILL_KEYS = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };

function section(fn) {
  try {
    return fn() ?? null;
  } catch {
    return null; // drop sections whose shape we don't recognize
  }
}

// Overview leaf layout (as replicated by open-source u.gg importers):
// [0] runes [m, w, primaryStyle, subStyle, [6 perks]]
// [1] summoner spells [m, w, [2 ids]]
// [2] starting items  [m, w, [ids]]
// [3] core items      [m, w, [3 ids]]
// [4] skills          [m, w, [order], "priority"]
// [5] item options    [[ [id, m, w], ... ] x3]  (4th/5th/6th slots)
// [6] winrate         [m, w]
// [8] stat shards     [m, w, [3 ids]]
export function parseOverview(data) {
  const out = {};
  out.runes = section(() => {
    const r = data[0];
    const perks = r.find((x) => Array.isArray(x) && x.length >= 4) || r[4];
    const styles = r.filter((x) => typeof x === 'number' && x >= 8000 && x < 8500);
    return { primaryStyle: styles[0] ?? null, subStyle: styles[1] ?? null, perks: perks.map(Number) };
  });
  out.spells = section(() => data[1].find((x) => Array.isArray(x)).map(Number));
  out.startItems = section(() => data[2].find((x) => Array.isArray(x)).map(Number));
  out.coreItems = section(() => data[3].find((x) => Array.isArray(x)).map(Number));
  out.skills = section(() => {
    const s = data[4];
    const order = s.find((x) => Array.isArray(x)) || [];
    const priority = s.find((x) => typeof x === 'string' && x.length <= 8) || null;
    return {
      order: order.slice(0, 12).map((k) => SKILL_KEYS[k] || String(k)),
      priority
    };
  });
  out.itemOptions = section(() =>
    data[5].map((slot) =>
      (Array.isArray(slot) ? slot : [])
        .filter((it) => Array.isArray(it) && it.length >= 3)
        .slice(0, 4)
        .map(([id, a, b]) => {
          const { wins, matches } = winsMatches(a, b);
          return { id: Number(id), winrate: pct(wins, matches), matches };
        })
    )
  );
  out.stats = section(() => {
    const { wins, matches } = winsMatches(data[6][0], data[6][1]);
    return { winrate: pct(wins, matches), matches };
  });
  out.shards = section(() => data[8].find((x) => Array.isArray(x)).map(Number));
  return out;
}

export async function buildFor(championId, queueKey, requestedRole) {
  const { json, patch, queue } = await fetchStats('overview', championId, queueKey);
  const roles = pickRoles(json);
  const available = Object.keys(roles);
  if (!available.length) {
    const err = new Error('Meta data came back empty for this champion/queue.');
    err.status = 404;
    throw err;
  }
  // Requested role, else the role with the biggest sample, else NONE (ARAM/Arena).
  let role = requestedRole && roles[requestedRole] ? requestedRole : null;
  if (!role) {
    role = available.reduce((best, r) => {
      const m = section(() => winsMatches(roles[r][6][0], roles[r][6][1]).matches) || 0;
      const bm = best ? section(() => winsMatches(roles[best][6][0], roles[best][6][1]).matches) || 0 : -1;
      return m > bm ? r : best;
    }, null);
  }
  return {
    source: 'u.gg', patch, queue, role, availableRoles: available,
    ...parseOverview(roles[role])
  };
}

// Matchup leaf: array of per-enemy arrays starting [enemyChampionId, ...]
// with a wins/matches pair among the following numbers.
export async function matchupsFor(championId, queueKey, requestedRole) {
  const { json, patch, queue } = await fetchStats('matchups', championId, queueKey);
  const roles = pickRoles(json);
  const available = Object.keys(roles);
  const role = requestedRole && roles[requestedRole] ? requestedRole : available[0];
  const leaf = roles[role];
  const rows = [];
  const list = Array.isArray(leaf?.[0]) && Array.isArray(leaf[0][0]) ? leaf[0] : leaf;
  for (const entry of list || []) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [enemy, a, b] = entry;
    const { wins, matches } = winsMatches(a, b);
    if (matches >= 30 && enemy > 0 && enemy < 5000) {
      rows.push({ championId: Number(enemy), winrate: pct(wins, matches), matches });
    }
  }
  rows.sort((x, y) => x.winrate - y.winrate);
  return { source: 'u.gg', patch, queue, role, availableRoles: available, matchups: rows };
}

export async function rawStats(kind, championId, queueKey) {
  return fetchStats(kind === 'matchups' ? 'matchups' : 'overview', championId, queueKey);
}
