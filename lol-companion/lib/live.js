// Live Client Data API — served by the game itself at https://127.0.0.1:2999
// while you are in a match. No API key or auth needed.
import { httpsJson } from './https.js';

export function liveGet(endpoint) {
  return httpsJson({
    host: '127.0.0.1',
    port: 2999,
    path: `/liveclientdata/${endpoint}`,
    timeout: 2500
  });
}

export async function liveAvailable() {
  try {
    await liveGet('gamestats');
    return true;
  } catch {
    return false;
  }
}
