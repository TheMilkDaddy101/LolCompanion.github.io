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
| 🔴 **Live Game** | Auto-detects what you're doing, in order: **in game** (local game client) → **champ select** → **pregame lobby** (your party members, before queue even pops) → spectator API for any Riot ID. Scouts every visible player: rank + LP + winrate, last-5 form dots, main champions by mastery, and tags like *Hot streak*, *One-trick alert*, *Rusty*, *Rough patch*. Opening the app while in a lobby scouts your teammates automatically. | Porofessor |
| 🔎 **Summoner** | Look up any Riot ID: profile, Solo/Flex ranks, top mastery champions, and paged match history with KDA, CS/min, damage, and full item builds. | u.gg / op.gg |
| 🛠️ **Builds** | Current-patch meta for any champion in **Ranked Solo, Ranked Flex, ARAM, and Arena**: runes + shards, summoner spells, skill priority and level order, starting/core items, 4th–6th item options with winrates, and matchup lists (toughest counters / best targets). Click any champion portrait in the Live tab to jump straight to their build. No API key needed for this tab. | u.gg / League of Graphs |
| 🏆 **For You** | Analyzes your last 30 games + champion mastery and scores every champion you play — smoothed winrate, KDA, play volume, and mastery depth — filterable by role. Tells you what you should actually be picking. | Mobalytics |
| ⚙️ **Settings** | API key, region, your Riot ID, optional League install path. | — |

## Quick start (Windows exe — easiest)

1. Grab **`LoLCompanion.exe`** from the repo's [Releases page](../../releases) — it's a single
   file, no install, no Node.js needed.
2. Put it in its own folder (it creates `config.json` and a match cache next to itself) and
   double-click it. Your browser opens at http://localhost:3577.
   - Windows SmartScreen will warn because the exe is unsigned — click **More info → Run anyway**.
3. Get a free Riot API key at [developer.riotgames.com](https://developer.riotgames.com) and paste
   it in **Settings**, along with your region and Riot ID.

To rebuild the exe yourself: `node build/build.mjs` (Node 20+), or run the
**Build LoL Companion Windows exe** workflow under the repo's Actions tab — it builds on a clean
Windows runner, smoke-tests the binary, and publishes a Release.

## Quick start (from source)

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
- Recommendations ("For You") are based on **your own data** (mastery + performance); the
  **Builds** tab covers the global meta side.
- Builds/matchups come from u.gg's public stats CDN — the same JSON their website loads. It's an
  unofficial, undocumented feed: the app parses it defensively (unrecognized sections are hidden,
  not fatal), caches each champion+queue for 12 hours to stay polite, and exposes the raw upstream
  JSON at `/api/meta/raw?championId=&queue=` for debugging if u.gg changes their format. Stats and
  build data are © their aggregators; this is for personal use.
- In ranked solo/duo champ select, Riot hides your **allies'** names in the UI, but the app
  reveals them from the team chat room (the same public technique Porofessor/Blitz use) and scouts
  them automatically — revealed players are tagged as such. **Enemy** names stay hidden until the
  loading screen, at which point the enemy team becomes scoutable too.
- This folder is a **local app**, not part of the GitHub Pages site (browsers can't talk to the
  League client from a hosted page). Clone the repo and run it locally.

## Legal

LoL Companion isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games
or anyone officially involved in producing or managing Riot Games properties. It uses only
Riot-provided public APIs (the same ones Porofessor/u.gg use) and complies with Riot's third-party
application policies — it reads data; it never automates gameplay.
