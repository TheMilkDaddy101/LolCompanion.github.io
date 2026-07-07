# ⚔️ LoL Companion

A lightweight, local League of Legends companion app — the best-of-all-worlds features of
**Porofessor** (live game scouting), **u.gg / op.gg** (summoner lookup & match history), and
**Mobalytics** (champion recommendations) — without Overwolf, ads, overlays, or anything
bogging your machine down.

- **Zero dependencies.** One `node server.js` — no `npm install`, no Electron, no background services.
- **Runs entirely on your machine.** Your API key and cache never leave your computer.
- **Polite to Riot.** Built-in rate limiting and aggressive caching (finished matches are cached
  to disk forever), so a free dev key goes a long way.

## Features

| Tab | What it does | Mimics |
| --- | --- | --- |
| 🔴 **Live Game** | Auto-detects your running game (works in champ select→loading→in game via the local game client, or via the spectator API for any Riot ID). Scouts all 10 players: rank + LP + winrate, last-5 form dots, main champions by mastery, and tags like *Hot streak*, *One-trick alert*, *Rusty*, *Rough patch*. | Porofessor |
| 🔎 **Summoner** | Look up any Riot ID: profile, Solo/Flex ranks, top mastery champions, and paged match history with KDA, CS/min, damage, and full item builds. | u.gg / op.gg |
| 🏆 **For You** | Analyzes your last 30 games + champion mastery and scores every champion you play — smoothed winrate, KDA, play volume, and mastery depth — filterable by role. Tells you what you should actually be picking. | Mobalytics |
| ⚙️ **Settings** | API key, region, your Riot ID, optional League install path. | — |

## Quick start

1. **Install Node.js** (LTS) from [nodejs.org](https://nodejs.org) if you don't have it (`node -v` ≥ 18).
2. **Get a free Riot API key**: sign in at [developer.riotgames.com](https://developer.riotgames.com)
   and copy the *Development API Key*. (Dev keys expire every 24 hours — just regenerate and re-paste.)
3. **Run it**:
   - Windows: double-click `start.bat`
   - macOS/Linux: `./start.sh` (or `node server.js`)
4. Open **http://localhost:3577**, go to **Settings**, paste your key, pick your region,
   and enter your Riot ID (`GameName#TAG`).

That's it. Keep the terminal window open while you play.

## How it works

```
Browser UI (public/)  ──►  local Node server (server.js)
                              ├── LCU API        https://127.0.0.1:<port>  (client detection, champ select)
                              ├── Live Client    https://127.0.0.1:2999    (in-game data, no key needed)
                              ├── Riot API       account-v1, summoner-v4, league-v4,
                              │                  champion-mastery-v4, match-v5, spectator-v5
                              └── Data Dragon    static data & images (fetched by the browser)
```

- The server finds your League client automatically (lockfile in common install paths, or the
  running process's command line) — set the install folder in Settings if you use a custom path.
- Live-game detection prefers the **local game client** (instant, zero API calls); if you're not
  in a game on this machine it falls back to **spectator-v5** for the configured Riot ID, so you
  can also scout a friend's game.
- Scouting 10 players costs roughly 40–70 API calls the first time; the built-in throttle keeps you
  inside dev-key limits (players fill in one by one), and repeat scouts are mostly served from cache.

## Notes & limitations

- **Dev key limits** (20 req/s, 100 req/2 min) mean a full first-time scout takes ~30–60 seconds.
  Apply for a free *Personal* app key on the Riot developer portal for higher limits — it works
  identically, just paste it in Settings.
- Recommendations are based on **your own data** (mastery + performance). Global meta winrates /
  tier lists require aggregating millions of matches, which the big sites do server-side; a
  pluggable meta source is a natural future upgrade.
- In ranked champ select, Riot hides enemy names until loading screen — scouting the enemy team
  starts working once the game loads.
- This folder is a **local app**, not part of the GitHub Pages site (browsers can't talk to the
  League client from a hosted page). Clone the repo and run it locally.

## Legal

LoL Companion isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games
or anyone officially involved in producing or managing Riot Games properties. It uses only
Riot-provided public APIs (the same ones Porofessor/u.gg use) and complies with Riot's third-party
application policies — it reads data; it never automates gameplay.
