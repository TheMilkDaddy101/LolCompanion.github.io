#!/usr/bin/env bash
# LoL Companion launcher (macOS / Linux)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS) and run this again."
  exit 1
fi
(sleep 1 && (open http://localhost:3577 2>/dev/null || xdg-open http://localhost:3577 2>/dev/null)) &
exec node server.js
