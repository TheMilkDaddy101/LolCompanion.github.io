# LoL Companion — Local Development Handoff

This is the continuation guide for picking up **LoL Companion** in a **local**
Claude Code session (on the PC that has League + real internet). It was built
across a cloud session that could NOT reach the internet or the League client,
which is why the last few bugs stayed unsolved — locally you can finally
reproduce and see them directly.

**Read `CLAUDE.md` and `lol-companion/README.md` too.** This file is the
"where we are / what to do next" layer on top of those.

---

## 0. TL;DR — the single biggest advantage you now have

Run the server in a terminal and **watch it**:

```bash
cd lol-companion
node server.js         # needs Node 18+ (20+ to build the exe). Opens http://localhost:3577
```

When something fails in the browser with **"Failed to fetch"**, the terminal
running `node server.js` will print the actual error / stack trace live. That
single fact unblocks the #1 bug below. In the cloud we only had a log file;
locally you have the live console. Use it first.

---

## 1. What this app is

Zero-dependency local Node server (`server.js`) + vanilla-JS frontend
(`public/`) that replaces Porofessor + u.gg + Mobalytics. No npm deps at
runtime. Talks to:

- **Riot API** (needs the user's key in `config.json`) — ranks, mastery, match
  history, spectator.
- **League Client (LCU)** at `https://127.0.0.1:<port>` — champ select, lobby,
  and the **name-reveal** trick (`/chat/v5/participants`).
- **Live Client API** at `https://127.0.0.1:2999` — in-game data (no key).
- **u.gg stats CDN** — meta builds/runes/matchups (no key). **URL format
  unverified — see bug #2.**
- **Data Dragon** — static champ/item/rune data + images (browser-side).

Config + caches live next to the exe/source, falling back to
`%APPDATA%\lol-companion` when that folder isn't writable. `config.json` holds
the Riot key and is gitignored — never commit it.

## 2. Repo / branch / release facts

- **Repo moved** to `TheMilkDaddy101/LolCompanion.github.io` (was
  `JamesLedford1/...`). Git remote still works via redirect; update it with
  `git remote set-url origin https://github.com/TheMilkDaddy101/LolCompanion.github.io.git`.
- Work branch: **`claude/lol-data-aggregator-nyp28w`**, tracked by **PR #1**.
- Every push touching `lol-companion/**` auto-builds a Windows exe via
  `.github/workflows/build-windows-exe.yml` and publishes a GitHub Release
  (`companion-build-N`). Latest at time of handoff: **build 16**.
- Repo was made **public** so it can be shared.

## 3. What WORKS (confirmed on the user's PC)

- Config save + `/api/keycheck` (validates the Riot key).
- **Champ-select ally reveal** — in ranked solo/duo, all 5 teammates' real
  names now show (verified via screenshot). Built from the chat room in
  `detectPregame()` (`server.js`) + `champSelectChatMembers()` (`lib/lcu.js`).
- Summoner lookup, the whole UI/design, the sidebar build-number label.
- Scout cards show recent-play data (last 30 days) — WHEN the Riot calls
  succeed (see bug #1).

## 4. OPEN BUGS — in priority order

> **STATUS UPDATE (2026-07-09, local session):** Bugs #1 and #2 below are
> FIXED and verified against a live game + live u.gg data.
> - **#2 root cause:** u.gg's CDN 403-blocks Node's TLS fingerprint (any
>   undici/node:https request, headers irrelevant) but accepts curl. u.gg
>   requests now go through Windows' bundled `curl.exe` (`uggGet` in
>   `lib/meta.js`). The URL format itself was already right:
>   `stats2.u.gg/lol/1.5/overview/{dd_patch}/{queue}/{champId}/1.5.0.json`.
>   The real leaf format is `[payload, timestamp]` — `pickRoles` unwraps it;
>   all `parseOverview` sections verified against patch 16_13.
> - **#1 root causes:** spectator/live-client report hidden or bot players
>   as riotId `"#"` (now sanitized + puuid fallback), and slow Riot calls
>   piled up behind the throttle (playerDossier now answers within 20s with
>   a "Riot data delayed" card while the real fetch finishes in the
>   background and lands in the 2-minute dossier cache).
> - **#3 (Porofessor):** moot — u.gg works. Don't switch; Porofessor and
>   League of Graphs are Cloudflare-fronted HTML, strictly worse to parse.

### Bug #1 (TOP PRIORITY): "Failed to fetch" — per-player stats / whole scout
**Symptom:** In a live game / champ select, names reveal but every player card
says **"Failed to fetch"**, and sometimes the entire scout + Builds + Diagnose
all say "Failed to fetch" at once. Sidebar status dots stay green (misleading —
they only update on success and are left as-is on failure).

**What "Failed to fetch" means:** it's the *browser's* error for "couldn't
reach the local server at all" — NOT a Riot/u.gg error (those return a JSON
error message or an empty card). So the server is either crashing or the
browser can't reach `localhost:3577` for those routes.

**Leading hypotheses (test locally, in order):**
1. **Server crash** on the Riot-scouting path. Run `node server.js` in a
   terminal, reproduce, and read the stack trace. In the cloud, a fake-puuid
   dossier returned an empty card gracefully (no crash), so the crash is
   something only reproducible with the real client/key/network.
2. **Pi-hole / DNS filter** (the user runs Pi-hole — visible in their
   bookmarks). It may be blocking `ddragon.leagueoflegends.com` and/or the
   Riot API hosts, making browser-side `DD.loadStatics()` and server-side
   Riot `fetch()` fail. Check Pi-hole's Query Log while scouting; try
   whitelisting `ddragon.leagueoflegends.com`, `*.api.riotgames.com`,
   `stats2.u.gg`.
3. **Browser can't reach localhost for slow routes** (extension/proxy). Test
   by opening `http://localhost:3577/api/scout` and `/api/logs` directly in
   the address bar (bypasses app fetch). If address bar works but in-app
   fetch fails → browser/extension/proxy issue.

**Already in place to help:** `process.on('uncaughtException'/'unhandledRejection')`
guards (`server.js`), a 45s per-request timeout, 10s Riot-fetch timeout
(`lib/riot.js` `riotHttp`), and an error log at `error.log` next to the config
(view via Settings → "Show error log", or `GET /api/logs`, or open the file).

**Definitive next step:** `node server.js` in a terminal → reproduce → read the
console. That's the answer we never got remotely.

### Bug #2: Builds / runes never reliably load (u.gg URL format unverified)
**Symptom:** Builds tab fails. Root cause: the u.gg stats CDN URL format is
GUESSED in `lib/meta.js` because the cloud sandbox couldn't reach u.gg.

**The URL pattern tried:**
`https://stats2.u.gg/lol/{prefix}/overview|matchups/{patch}/{queue}/{champId}/{ver}.json`
with `prefix ∈ {1.5, 1.1}`, `ver ∈ {1.5.0, 1.4.0}`, and patch in both Data
Dragon (`16_x`) and marketing (`26_x`) numbering.

**How to fix locally (you have internet):**
```bash
# Find the current patch:
curl -s https://ddragon.leagueoflegends.com/api/versions.json | head -c 40
# Then probe u.gg directly until one returns JSON (try Lulu = 117):
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://stats2.u.gg/lol/1.5/overview/<PATCH>/ranked_solo_5x5/117/1.5.0.json"
```
Or in the running app: **Builds tab → "Diagnose"** button (calls
`/api/meta/probe`) — it fires every candidate URL in parallel and shows each
status. Once you find the 200, fix the format in `lib/meta.js`
(`PATH_PREFIXES`, `API_VERSIONS`, `patchCandidates`, and the `stats2.u.gg`
URL). Then verify `parseOverview()` against the real JSON shape (the leaf
array indices for runes/items/skills/winrate may need adjusting — the parser
is defensive and drops sections it can't read, so a partial build = index
mismatch, not a crash). Unit-test pattern is in the git history under
scratchpad `meta-test.mjs`.

### Bug #3: Porofessor as an alternate source (experimental, build 16)
`lib/porofessor.js` + `/api/porofessor/probe` + Settings "Test Porofessor"
button. Fetches Porofessor's live page/partial server-side (no key, reveals
names itself). **Unverified — Porofessor is behind Cloudflare and may block
scripts.** Click "Test Porofessor" locally: if it returns real player HTML,
build a parser against it; if Cloudflare wall, drop it.
**Important limitation:** Porofessor's live page only exists AFTER a match
starts — it CANNOT provide pre-matchmaking (champ-select) stats, which the
user specifically needs. So Porofessor can only ever be an in-game/builds
bonus, not a replacement for the Riot path (bug #1).

## 5. File map

| File | Purpose |
|------|---------|
| `server.js` | HTTP server, routes, `detectLiveGame`/`detectPregame` (reveal) |
| `lib/riot.js` | Riot API client: throttle, TTL cache, disk match cache, `riotHttp` timeout |
| `lib/aggregate.js` | `playerDossier` (30-day scout), `champStats`, `summonerBundle`, `recommendations` |
| `lib/meta.js` | u.gg builds/matchups, `diagnose`, `parseOverview` — **bug #2 lives here** |
| `lib/lcu.js` | League client access + `champSelectChatMembers` (reveal) |
| `lib/live.js` | Live Client Data API (in-game) |
| `lib/porofessor.js` | experimental Porofessor probe (bug #3) |
| `lib/config.js` / `lib/paths.js` | config + writable data dir with `%APPDATA%` fallback |
| `lib/log.js` | error log (`error.log`, `/api/logs`) |
| `public/index.html` / `app.js` / `style.css` | frontend (vanilla JS) |
| `build/build.mjs` | packages everything into one Windows exe (Node SEA) |
| `.github/workflows/build-windows-exe.yml` | CI build + release on push |

## 6. Debug endpoints (open in browser or curl while `node server.js` runs)

- `GET /api/health` — client/game/key status + build version
- `GET /api/logs` — recent errors (also in `error.log`)
- `GET /api/scout` — current live game / champ select / lobby roster
- `GET /api/lcu/reveal` — raw champ-select chat members (reveal debug)
- `GET /api/meta/diagnose` — full sequential u.gg attempt (slow)
- `GET /api/meta/probe?championId=117&queue=ranked_solo` — fast parallel u.gg probe
- `GET /api/porofessor/probe?riotId=Name%23TAG&platform=na1` — Porofessor reachability
- `GET /api/keycheck` — validate saved Riot key against Riot

## 7. Suggested local first session

1. `cd lol-companion && node server.js` (keep the terminal visible).
2. Open http://localhost:3577, confirm Settings shows a valid key
   (get a fresh one at developer.riotgames.com — dev keys expire every 24h;
   a registered "Personal" key doesn't expire — the user has one named
   "LOL COMPANION").
3. In a champ select or game, click "Scout current game." Watch the terminal.
   Whatever prints when a card says "Failed to fetch" is bug #1's root cause.
4. Fix bug #1. Then Builds tab → Diagnose to nail the u.gg URL (bug #2).
5. Commit + push to `claude/lol-data-aggregator-nyp28w` → CI publishes a new
   exe automatically. Don't commit `config.json` or `error.log`.

## 8. Conventions / guardrails

- Zero runtime npm deps. Keep it that way.
- Never commit `config.json` (Riot key) or `error.log` (both gitignored).
- Match the existing code style; the frontend is plain DOM, no framework.
- Test a change by actually running `node server.js` and driving the flow —
  that's the whole point of being local now.
