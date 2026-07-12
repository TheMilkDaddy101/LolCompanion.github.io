// LoL Companion — a lightweight local alternative to Porofessor / u.gg /
// Mobalytics. Zero dependencies: run `node server.js` and open the printed URL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { getConfig, saveConfig, publicConfig } from './lib/config.js';
import { lcuGet, lcuAvailable, champSelectChatMembers } from './lib/lcu.js';
import { liveGet, liveAvailable } from './lib/live.js';
import { accountByRiotId, activeGameByPuuid, activeRegionByPuuid, checkKey, PLATFORMS } from './lib/riot.js';
import { playerDossier, summonerBundle, recommendations } from './lib/aggregate.js';
import { buildFor, matchupsFor, rawStats, diagnose, QUEUES, lastAttempts, currentPatch } from './lib/meta.js';
import { appDir } from './lib/paths.js';
import { logError, recentErrors } from './lib/log.js';
import { probe as porofessorProbe } from './lib/porofessor.js';

// Never let a stray error or rejected promise take the whole app down —
// a single failed u.gg/Riot request must not kill scouting for everyone.
process.on('uncaughtException', (err) => logError('uncaughtException', err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

const PUBLIC_DIR = path.join(appDir(), 'public');
// Set by the single-executable build — maps filename -> file contents.
const EMBEDDED_PUBLIC = globalThis.__EMBEDDED_PUBLIC__ || null;
const PORT = Number(process.env.PORT || 3577);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Riot's spectator and live-client feeds report hidden/bot players with a
// junk Riot ID (literally "#", or a bare name with no tag). Only pass along
// names that can actually resolve through the API.
function cleanRiotId(riotId) {
  if (!riotId || typeof riotId !== 'string') return null;
  const [name, tag] = riotId.split('#');
  return name && tag ? riotId : null;
}

// One LCU team member (lobby or champ select) → scoutable participant.
// Prefer the Riot ID name when the client exposes it: names always resolve
// through the public API, while LCU puuids aren't guaranteed to.
function lcuParticipant(m, team) {
  const riotId =
    (m.gameName && m.tagLine && `${m.gameName}#${m.tagLine}`) ||
    (m.summonerName && m.summonerName.includes('#') ? m.summonerName : null);
  return {
    riotId,
    puuid: riotId ? null : m.puuid || null,
    championId: m.championId || null,
    position: (m.assignedPosition || m.firstPositionPreference || '').toUpperCase(),
    team
  };
}

// Pregame detection via the League client: champ select first (has champion
// picks), then the plain lobby (party members before queue pops).
async function detectPregame() {
  try {
    const session = await lcuGet('/lol-champ-select/v1/session');
    const myTeamRaw = session.myTeam || [];
    if (myTeamRaw.length) {
      // In ranked solo/duo the champ-select UI hides ally names AND puuids on
      // the session cells, so we can't rely on those. The team chat room
      // still lists every member with a real Riot ID + puuid — use that as
      // the roster and pull champion/position from session cells by puuid.
      let members = [];
      try { members = await champSelectChatMembers(); } catch { /* reveal unavailable */ }

      const cellByPuuid = new Map();
      for (const m of myTeamRaw) if (m.puuid) cellByPuuid.set(m.puuid, m);

      let myPuuid = null;
      try { myPuuid = (await lcuGet('/lol-summoner/v1/current-summoner')).puuid; } catch { /* ignore */ }

      const namedCells = myTeamRaw.filter((m) => (m.gameName && m.tagLine) || m.summonerName);
      let mine;
      if (members.some((r) => r.puuid) && members.length >= namedCells.length) {
        // Build from revealed chat members (complete, real identities).
        mine = members.map((mem) => {
          const cell = mem.puuid ? cellByPuuid.get(mem.puuid) : null;
          const self = myPuuid ? mem.puuid === myPuuid : false;
          return {
            riotId: mem.riotId,
            puuid: mem.puuid,
            championId: cell?.championId || null,
            position: (cell?.assignedPosition || '').toUpperCase(),
            team: 'ORDER',
            revealed: !self,
            self
          };
        });
      } else {
        // Names aren't hidden (e.g. normal draft) — use session cells directly.
        mine = namedCells.map((m) => ({
          ...lcuParticipant(m, 'ORDER'),
          self: m.cellId != null && m.cellId === session.localPlayerCellId
        }));
      }
      const theirs = (session.theirTeam || [])
        .filter((m) => m.puuid || m.gameName)
        .map((m) => lcuParticipant(m, 'CHAOS'));
      return { source: 'champselect', revealedCount: members.length, participants: [...mine, ...theirs] };
    }
  } catch {
    // not in champ select
  }
  try {
    const lobby = await lcuGet('/lol-lobby/v2/lobby');
    const members = (lobby.members || []).filter((m) => m.puuid || m.summonerName);
    if (members.length) {
      const me = lobby.localMember || {};
      return {
        source: 'lobby',
        gameMode: lobby.gameConfig?.gameMode,
        participants: members.map((m) => ({
          ...lcuParticipant(m, 'ORDER'),
          self: Boolean((me.puuid && m.puuid === me.puuid) || (me.summonerId && m.summonerId === me.summonerId))
        }))
      };
    }
  } catch {
    // not in a lobby
  }
  return null;
}

// Figure out the current game/lobby and its participants, preferring the
// local game client (in game, zero API calls), then champ select, then the
// pregame lobby, finally spectator-v5 for the configured Riot ID.
async function detectLiveGame(riotIdOverride) {
  const cfg = getConfig();
  // A typed Riot ID means "spectate THAT player" — skip local detection
  // entirely so being in your own game/lobby can't shadow the request.
  if (!riotIdOverride) {
    try {
      const [players, stats, activeName] = await Promise.all([
        liveGet('playerlist'),
        liveGet('gamestats'),
        liveGet('activeplayername').catch(() => null)
      ]);
      return {
        source: 'local-client',
        gameMode: stats.gameMode,
        gameTime: stats.gameTime,
        participants: players.map((p) => ({
          riotId: cleanRiotId(p.riotId),
          championName: p.championName,
          team: p.team, // ORDER / CHAOS
          position: p.position || '',
          level: p.level,
          scores: p.scores,
          self: Boolean(activeName && p.riotId === activeName)
        }))
      };
    } catch {
      // Not in a running game locally — check pregame states.
    }
    const pregame = await detectPregame();
    if (pregame) return pregame;
  }
  const riotId = riotIdOverride || cfg.riotId;
  if (!riotId) {
    const err = new Error('No game, champ select, or lobby found on this machine, and no Riot ID is configured to spectate.');
    err.status = 404;
    throw err;
  }
  let account;
  try {
    account = await accountByRiotId(riotId, cfg.platform);
  } catch (e) {
    if (e.status === 404) {
      const err = new Error(`No Riot account called "${riotId}" exists — double-check the spelling and the #tag.`);
      err.status = 404;
      throw err;
    }
    throw e;
  }
  // Find the platform this player actually plays on — a friend on EUW (or a
  // smurf on another server) would 404 forever against the configured one.
  let platform = cfg.platform;
  try {
    const region = await activeRegionByPuuid(account.puuid, cfg.platform);
    if (region && PLATFORMS.includes(region)) platform = region;
  } catch {
    // endpoint unavailable for this account — stick with the configured platform
  }
  let game;
  try {
    game = await activeGameByPuuid(account.puuid, platform);
  } catch (e) {
    if (e.status === 404) {
      const err = new Error(
        `${riotId} (${platform.toUpperCase()}) is not in a spectatable game right now. ` +
        'Riot only exposes standard LoL matches to spectators (not TFT, custom games, or Practice Tool), ' +
        'and new games can take 2–4 minutes to appear.'
      );
      err.status = 404;
      throw err;
    }
    throw e;
  }
  return {
    source: 'spectator',
    platform,
    gameMode: game.gameMode,
    gameLength: game.gameLength,
    participants: game.participants.map((p) => ({
      riotId: cleanRiotId(p.riotId),
      puuid: p.puuid,
      championId: p.championId,
      team: p.teamId === 100 ? 'ORDER' : 'CHAOS',
      spells: [p.spell1Id, p.spell2Id],
      // Players who enabled Riot's privacy option arrive with a null puuid
      // and their champion's name where the Riot ID should be.
      anonymous: !p.puuid && !cleanRiotId(p.riotId),
      self: p.puuid === account.puuid
    }))
  };
}

const routes = {
  'GET /api/health': async () => {
    const [client, inGame] = await Promise.all([lcuAvailable(), liveAvailable()]);
    return {
      clientDetected: client,
      inGame,
      version: globalThis.__APP_VERSION__ || 'source',
      ...publicConfig(),
      platforms: PLATFORMS
    };
  },

  // Verify the saved key actually works against Riot right now.
  'GET /api/keycheck': async () => {
    const cfg = getConfig();
    if (!cfg.riotApiKey) {
      const err = new Error('No API key saved yet.');
      err.status = 428;
      throw err;
    }
    await checkKey(cfg.platform);
    return { ok: true, platform: cfg.platform };
  },

  'GET /api/config': async () => publicConfig(),

  'POST /api/config': async (req) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    saveConfig(body);
    return publicConfig();
  },

  'GET /api/lcu/summoner': async () => lcuGet('/lol-summoner/v1/current-summoner'),
  'GET /api/lcu/champselect': async () => lcuGet('/lol-champ-select/v1/session'),
  'GET /api/lcu/gameflow': async () => lcuGet('/lol-gameflow/v1/gameflow-phase'),
  'GET /api/lcu/reveal': async () => champSelectChatMembers(),

  // Recent errors (also written to error.log next to the config) — the
  // Settings "Show error log" button reads this so problems are visible.
  'GET /api/logs': async () => recentErrors(),

  // Experimental: can we reach Porofessor's live page from this machine?
  'GET /api/porofessor/probe': async (req, url) => {
    const cfg = getConfig();
    const riotId = url.searchParams.get('riotId') || cfg.riotId;
    if (!riotId) throw Object.assign(new Error('Set your Riot ID in Settings, or pass ?riotId='), { status: 400 });
    return porofessorProbe(url.searchParams.get('platform') || cfg.platform, riotId);
  },

  'GET /api/live/allgamedata': async () => liveGet('allgamedata'),

  'GET /api/scout': async (req, url) => detectLiveGame(url.searchParams.get('riotId') || undefined),

  'GET /api/scout/player': async (req, url) => {
    const cfg = getConfig();
    return playerDossier({
      riotId: url.searchParams.get('riotId') || undefined,
      puuid: url.searchParams.get('puuid') || undefined,
      championId: Number(url.searchParams.get('championId')) || null,
      platform: url.searchParams.get('platform') || cfg.platform
    });
  },

  'GET /api/summoner': async (req, url) => {
    const cfg = getConfig();
    const riotId = url.searchParams.get('riotId');
    if (!riotId) {
      const err = new Error('riotId query parameter required (GameName#TAG)');
      err.status = 400;
      throw err;
    }
    return summonerBundle(riotId, url.searchParams.get('platform') || cfg.platform, {
      count: Math.min(20, Number(url.searchParams.get('count')) || 10),
      start: Number(url.searchParams.get('start')) || 0
    });
  },

  // Meta builds & matchups (u.gg public stats CDN, cached 12h on disk).
  // No Riot API key needed for these.
  'GET /api/meta/build': async (req, url) => {
    const championId = Number(url.searchParams.get('championId'));
    if (!championId) throw Object.assign(new Error('championId required'), { status: 400 });
    return buildFor(
      championId,
      url.searchParams.get('queue') || 'ranked_solo',
      url.searchParams.get('role') || null
    );
  },

  'GET /api/meta/matchups': async (req, url) => {
    const championId = Number(url.searchParams.get('championId'));
    if (!championId) throw Object.assign(new Error('championId required'), { status: 400 });
    return matchupsFor(
      championId,
      url.searchParams.get('queue') || 'ranked_solo',
      url.searchParams.get('role') || null
    );
  },

  // Raw upstream JSON for debugging format drift.
  'GET /api/meta/raw': async (req, url) =>
    rawStats(
      url.searchParams.get('kind') || 'overview',
      Number(url.searchParams.get('championId')),
      url.searchParams.get('queue') || 'ranked_solo'
    ),

  'GET /api/meta/queues': async () => Object.keys(QUEUES),

  // Fast parallel probe for the Builds-tab Diagnose button.
  'GET /api/meta/probe': async (req, url) =>
    diagnose(Number(url.searchParams.get('championId')) || 117, url.searchParams.get('queue') || 'ranked_solo'),

  // Every URL the meta fetcher tried on its most recent failure, plus a
  // fresh attempt — paste this output when reporting "builds won't load".
  'GET /api/meta/diagnose': async (req, url) => {
    const championId = Number(url.searchParams.get('championId')) || 103; // Ahri
    const queue = url.searchParams.get('queue') || 'ranked_solo';
    let outcome;
    try {
      const r = await buildFor(championId, queue, null);
      outcome = { ok: true, patch: r.patch, queue: r.queue, role: r.role };
    } catch (err) {
      outcome = { ok: false, error: err.message };
    }
    let ddragonPatch = null;
    try {
      ddragonPatch = await currentPatch();
    } catch (err) {
      ddragonPatch = `unavailable: ${err.message}`;
    }
    return { outcome, ddragonPatch, attempts: lastAttempts };
  },

  'GET /api/recommendations': async (req, url) => {
    const cfg = getConfig();
    const riotId = url.searchParams.get('riotId') || cfg.riotId;
    if (!riotId) {
      const err = new Error('Set your Riot ID in Settings first so I know whose games to analyze.');
      err.status = 400;
      throw err;
    }
    return recommendations(riotId, url.searchParams.get('platform') || cfg.platform);
  }
};

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  // Always revalidate the UI: a browser tab must never keep running an old
  // frontend against a newer exe (heuristic caching would otherwise allow it).
  const staticHeaders = (type) => ({ 'Content-Type': type, 'Cache-Control': 'no-cache' });
  if (EMBEDDED_PUBLIC) {
    const name = filePath.replace(/^[/\\]+/, '');
    const content = EMBEDDED_PUBLIC[name];
    if (content !== undefined) {
      res.writeHead(200, staticHeaders(MIME[path.extname(name)] || 'application/octet-stream'));
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
    return;
  }
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, staticHeaders(MIME[path.extname(full)] || 'application/octet-stream'));
    res.end(data);
  });
}

// Only answer requests addressed to localhost. The server already binds to
// 127.0.0.1, but without this a malicious website could use DNS rebinding
// (pointing its own domain at 127.0.0.1) to read responses from this API
// while you browse. Riot IDs and lobby data are low-stakes, but there's no
// reason to leave the door open.
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, 'localhost', '127.0.0.1'
]);

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: bad Host header');
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    // Guarantee a response: if a handler ever hangs, answer with an error at
    // 45s instead of leaving the browser stuck (which shows as "Failed to
    // fetch"). Every failure is logged so it's visible in /api/logs.
    let done = false;
    const timeoutMs = url.pathname === '/api/scout/player' ? 90_000 : 45_000;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      logError(`timeout ${req.method} ${url.pathname}`, new Error(`handler exceeded ${Math.round(timeoutMs / 1000)}s`));
      try { sendJson(res, 504, { error: 'This request took too long and was aborted (see Settings -> error log).' }); } catch {}
    }, timeoutMs);
    try {
      const result = await handler(req, url);
      if (!done) { done = true; clearTimeout(guard); sendJson(res, 200, result ?? null); }
    } catch (err) {
      logError(`${req.method} ${url.pathname}`, err);
      if (!done) {
        done = true;
        clearTimeout(guard);
        sendJson(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, {
          error: err.message || 'Internal error'
        });
      }
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: `No such endpoint: ${url.pathname}` });
    return;
  }
  serveStatic(req, res, url);
});

function openBrowser(url) {
  if (process.env.LOL_NO_OPEN) return;
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best effort — the URL is printed either way
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  LoL Companion is already running — opening http://localhost:${PORT}`);
    console.log('  (Close the other window first if you meant to restart it.)');
    openBrowser(`http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  console.error('Failed to start:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  LoL Companion is running');
  console.log(`  ->  ${url}`);
  console.log('');
  console.log('  Tips:');
  console.log('   - Add your (free) Riot API key in Settings: https://developer.riotgames.com');
  console.log('   - Keep this window open while you play. Ctrl+C (or close it) to quit.');
  console.log('');
  openBrowser(url);
});
