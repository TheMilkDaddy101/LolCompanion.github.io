// Where the app lives on disk — where config.json and cache/ are kept.
// When packaged as a single executable, the build entry sets
// globalThis.__APP_DIR__ to the folder containing the .exe; when running
// from source it's the lol-companion project folder.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function appDir() {
  if (globalThis.__APP_DIR__) return globalThis.__APP_DIR__;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}
