# Project context for Claude Code

This repo contains **LoL Companion** (`lol-companion/`) — a zero-dependency local
League of Legends companion app (Porofessor/u.gg/Mobalytics-style) built across a
Claude Code cloud session on branch `claude/lol-data-aggregator-nyp28w` (PR #1).
Read `lol-companion/README.md` for the full feature list and architecture.

## Quick start for a local session

- Run from source: `cd lol-companion && node server.js` → http://localhost:3577
- Build the Windows exe: `node lol-companion/build/build.mjs` (Node 20+); CI also
  builds it on every push to the branch and publishes a GitHub Release.
- Config + caches live next to the exe/source, falling back to
  `%APPDATA%\lol-companion` when that folder isn't writable.

## Current state (as of build 10)

- User confirmed the app works end-to-end on their PC (config save, key check,
  u.gg meta fetch all functioning as of build 9).
- Build 10 replaced mastery-based "Mains" on scout cards with real play data:
  each dossier analyzes the player's ranked games from the last 30 days, capped
  at 25 (`WINDOW_DAYS`/`SCOUT_WINDOW` in `lib/aggregate.js`) into `champStats` (per-champ WR/games/KDA) and `onChamp`
  (their record on the champion they're currently playing), u.gg-style.
- Champ-select ally reveal: solo/duo hides ally names in the champ-select UI,
  so `champSelectChatMembers()` in `lib/lcu.js` reads `/chat/v5/participants`
  (team chat room, cid contains "champ-select") to recover real Riot
  IDs+puuids, merged into the scout by puuid in `detectPregame()`. Debug via
  `GET /api/lcu/reveal`.
- Debug endpoints: `GET /api/meta/diagnose` (u.gg URL attempts),
  `GET /api/keycheck` (validates saved key against Riot),
  `GET /api/lcu/reveal` (champ-select chat members).
- The Riot API dev key expires every 24h — regenerate at
  developer.riotgames.com when testing. A Personal API key doesn't expire.

## Conventions

- Zero npm dependencies at runtime; vanilla JS frontend in `lol-companion/public/`.
- Never commit `config.json` (gitignored — contains the user's Riot API key).
- Pushes touching `lol-companion/**` auto-build a Windows exe release via
  `.github/workflows/build-windows-exe.yml`.
