// Lightweight error log: keeps the last N errors in memory (exposed at
// /api/logs) and appends them to error.log next to the config, so problems
// on a user's machine are visible without their console.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.js';

const MAX = 100;
const ring = [];
let logFile = null;

function file() {
  if (!logFile) logFile = path.join(dataDir(), 'error.log');
  return logFile;
}

export function logError(context, err) {
  const entry = {
    at: new Date().toISOString(),
    context,
    message: err?.message || String(err),
    stack: err?.stack || null
  };
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  try {
    fs.appendFileSync(file(), `[${entry.at}] ${context}: ${entry.message}\n${entry.stack || ''}\n\n`);
  } catch {
    // logging must never itself throw
  }
  return entry;
}

export function recentErrors() {
  return { count: ring.length, file: file(), errors: ring.slice(-40).reverse() };
}
