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
  each dossier analyzes the player's last 15 ranked games (`SCOUT_WINDOW` in
  `lib/aggregate.js`) into `champStats` (per-champ WR/games/KDA) and `onChamp`
  (their record on the champion they're currently playing), u.gg-style.
- Debug endpoints: `GET /api/meta/diagnose` (u.gg URL attempts),
  `GET /api/keycheck` (validates saved key against Riot).
- The Riot API dev key expires every 24h — regenerate at
  developer.riotgames.com when testing. A Personal API key doesn't expire.

## Conventions

- Zero npm dependencies at runtime; vanilla JS frontend in `lol-companion/public/`.
- Never commit `config.json` (gitignored — contains the user's Riot API key).
- Pushes touching `lol-companion/**` auto-build a Windows exe release via
  `.github/workflows/build-windows-exe.yml`.
