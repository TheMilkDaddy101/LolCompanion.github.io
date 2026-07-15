// League Client (LCU) API access.
// The client writes a "lockfile" (name:pid:port:password:protocol) when it
// starts; we find it via config, common install paths, or the running
// process's command line, then talk to https://127.0.0.1:<port> with basic auth.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpsJson } from './https.js';
import { getConfig } from './config.js';

const execFileP = promisify(execFile);

const COMMON_LOCKFILE_PATHS = [
  'C:/Riot Games/League of Legends/lockfile',
  'D:/Riot Games/League of Legends/lockfile',
  'C:/Program Files/Riot Games/League of Legends/lockfile',
  '/Applications/League of Legends.app/Contents/LoL/lockfile'
];

let credCache = { creds: null, at: 0 };

function parseLockfile(raw) {
  const [, , port, password] = raw.trim().split(':');
  if (!port || !password) return null;
  return { port: Number(port), password };
}

async function fromLockfiles() {
  const cfg = getConfig();
  const candidates = [...COMMON_LOCKFILE_PATHS];
  if (cfg.leaguePath) candidates.unshift(path.join(cfg.leaguePath, 'lockfile'));
  if (process.env.LOL_LOCKFILE) candidates.unshift(process.env.LOL_LOCKFILE);
  for (const file of candidates) {
    try {
      const creds = parseLockfile(fs.readFileSync(file, 'utf8'));
      if (creds) return creds;
    } catch {
      // not there, keep looking
    }
  }
  return null;
}

// Fall back to reading --app-port / --remoting-auth-token off the running
// LeagueClientUx process, which works for any install location.
async function fromProcessList() {
  try {
    let cmdline = '';
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('powershell.exe', [
        '-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"
      ], { timeout: 8000 });
      cmdline = stdout;
    } else {
      const { stdout } = await execFileP('ps', ['x', '-o', 'command'], { timeout: 8000 });
      cmdline = stdout.split('\n').find((l) => l.includes('LeagueClientUx')) || '';
    }
    const port = cmdline.match(/--app-port=(\d+)/)?.[1];
    const password = cmdline.match(/--remoting-auth-token=([\w-]+)/)?.[1];
    if (port && password) return { port: Number(port), password };
  } catch {
    // process scan unavailable — fine
  }
  return null;
}

export async function getLcuCredentials() {
  if (credCache.creds && Date.now() - credCache.at < 10_000) return credCache.creds;
  const creds = (await fromLockfiles()) || (await fromProcessList());
  credCache = { creds, at: Date.now() };
  return creds;
}

export async function lcuGet(apiPath) {
  const creds = await getLcuCredentials();
  if (!creds) {
    const err = new Error('League client not detected');
    err.status = 503;
    throw err;
  }
  return httpsJson({
    host: '127.0.0.1',
    port: creds.port,
    path: apiPath,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64'),
      Accept: 'application/json'
    }
  });
}

export async function lcuAvailable() {
  try {
    await lcuGet('/lol-summoner/v1/current-summoner');
    return true;
  } catch {
    return false;
  }
}

// Reveal hidden solo/duo teammate identities in champ select.
// Riot hides ally names in the champ-select UI for ranked, but the team
// chat room still lists every member with their real Riot ID and puuid.
// (Same public technique used by Porofessor / Blitz / the `reveal` tool.)
export async function champSelectChatMembers() {
  // Riot removes these routes patch by patch (champ-select anonymity war) —
  // try every known source and use whichever still answers on this client.
  const sources = [
    // Classic: chat v5 participants filtered to the champ-select room.
    // Confirmed removed (404) in the client build shipped 2026-07-13.
    async () => {
      const raw = await lcuGet('/chat/v5/participants');
      const list = Array.isArray(raw) ? raw : raw?.participants || [];
      return list.filter((p) => typeof p.cid === 'string' && p.cid.includes('champ-select'));
    },
    // Older route: find the championSelect conversation, list its members.
    async () => {
      const convs = await lcuGet('/lol-chat/v1/conversations');
      const cs = (Array.isArray(convs) ? convs : []).find((c) => c.type === 'championSelect');
      if (!cs) return [];
      return lcuGet(`/lol-chat/v1/conversations/${encodeURIComponent(cs.id)}/participants`);
    }
  ];
  for (const source of sources) {
    try {
      const members = ((await source()) || [])
        .map((p) => ({
          puuid: p.puuid || null,
          riotId: (p.game_name && p.game_tag) ? `${p.game_name}#${p.game_tag}`
            : (p.gameName && p.gameTag) ? `${p.gameName}#${p.gameTag}`
            : p.name || null,
          summonerId: p.summoner_id || p.summonerId || null
        }))
        .filter((p) => p.puuid || p.riotId);
      if (members.length) return members;
    } catch {
      // route gone on this client build — try the next one
    }
  }
  return [];
}
