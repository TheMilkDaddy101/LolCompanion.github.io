// LoL Companion — a lightweight local alternative to Porofessor / u.gg /
// Mobalytics. Zero dependencies: run `node server.js` and open the printed URL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { getConfig, saveConfig, publicConfig } from './lib/config.js';
import { lcuGet, lcuAvailable } from './lib/lcu.js';
import { liveGet, liveAvailable } from './lib/live.js';
import { accountByRiotId, activeGameByPuuid, PLATFORMS } from './lib/riot.js';
import { playerDossier, summonerBundle, recommendations } from './lib/aggregate.js';
import { buildFor, matchupsFor, rawStats, QUEUES, lastAttempts, currentPatch } from './lib/meta.js';
import { appDir } from './lib/paths.js';

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
    const mine = (session.myTeam || []).filter((m) => m.puuid || m.gameName || m.summonerName);
    const theirs = (session.theirTeam || []).filter((m) => m.puuid || m.gameName);
    if (mine.length) {
      return {
        source: 'champselect',
        participants: [
          ...mine.map((m) => ({
            ...lcuParticipant(m, 'ORDER'),
            self: m.cellId != null && m.cellId === session.localPlayerCellId
          })),
          ...theirs.map((m) => lcuParticipant(m, 'CHAOS'))
        ]
      };
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
        riotId: p.riotId,
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
  if (!riotIdOverride) {
    const pregame = await detectPregame();
    if (pregame) return pregame;
  }
  const riotId = riotIdOverride || cfg.riotId;
  if (!riotId) {
    const err = new Error('No game, champ select, or lobby found on this machine, and no Riot ID is configured to spectate.');
    err.status = 404;
    throw err;
  }
  const account = await accountByRiotId(riotId, cfg.platform);
  let game;
  try {
    game = await activeGameByPuuid(account.puuid, cfg.platform);
  } catch (e) {
    if (e.status === 404) {
      const err = new Error(`${riotId} is not currently in a game.`);
      err.status = 404;
      throw err;
    }
    throw e;
  }
  return {
    source: 'spectator',
    gameMode: game.gameMode,
    gameLength: game.gameLength,
    participants: game.participants.map((p) => ({
      riotId: p.riotId || null,
      puuid: p.puuid,
      championId: p.championId,
      team: p.teamId === 100 ? 'ORDER' : 'CHAOS',
      spells: [p.spell1Id, p.spell2Id],
      self: p.puuid === account.puuid
    }))
  };
}

const routes = {
  'GET /api/health': async () => {
    const [client, inGame] = await Promise.all([lcuAvailable(), liveAvailable()]);
    return { clientDetected: client, inGame, ...publicConfig(), platforms: PLATFORMS };
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
  if (EMBEDDED_PUBLIC) {
    const name = filePath.replace(/^[/\\]+/, '');
    const content = EMBEDDED_PUBLIC[name];
    if (content !== undefined) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
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
    try {
      const result = await handler(req, url);
      sendJson(res, 200, result ?? null);
    } catch (err) {
      sendJson(res, err.status && err.status >= 400 && err.status < 600 ? err.status : 500, {
        error: err.message || 'Internal error'
      });
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
