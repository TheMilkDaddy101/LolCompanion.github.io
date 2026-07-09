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

## Current state / known issues (as of build 9)

1. **u.gg meta fetch is unverified against the real endpoint.** The cloud sandbox
   couldn't reach the internet, so `lib/meta.js` guesses at
   `https://stats2.u.gg/lol/{prefix}/{overview|matchups}/{patch}/{queue}/{champId}/{ver}.json`
   with multiple patch-numbering schemes (Data Dragon `16_x` vs marketing `26_x`),
   prefixes (`1.5`, `1.1`) and versions (`1.5.0`, `1.4.0`). The user reported
   builds failing to load. **Debug with `GET /api/meta/diagnose`** (lists every
   URL tried + result) and by fetching candidate URLs directly; fix the URL
   scheme and/or the array-index parsing in `parseOverview()` (unit test:
   scratchpad `meta-test.mjs` pattern — parser tests live in the session
   history, re-derive from `parseOverview` docs in `lib/meta.js`).
2. **User reported the API key not saving** on their machine; build 9 added
   visible errors, `%APPDATA%` fallback, `/api/keycheck` (verifies key against
   Riot on save), and a build-number label in the sidebar. If it persists,
   reproduce locally — the Settings page now shows the config path and the
   exact failure.
3. The Riot API dev key expires every 24h — regenerate at
   developer.riotgames.com when testing.

## Conventions

- Zero npm dependencies at runtime; vanilla JS frontend in `lol-companion/public/`.
- Never commit `config.json` (gitignored — contains the user's Riot API key).
- Pushes touching `lol-companion/**` auto-build a Windows exe release via
  `.github/workflows/build-windows-exe.yml`.
