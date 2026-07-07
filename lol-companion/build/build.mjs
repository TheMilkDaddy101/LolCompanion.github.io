// Build LoL Companion into a single double-clickable executable using
// Node's Single Executable Application (SEA) support.
//
//   node build/build.mjs
//
// Produces dist/LoLCompanion.exe on Windows (dist/LoLCompanion elsewhere).
// The only build-time downloads are esbuild + postject via npx; the final
// exe has zero runtime dependencies and embeds the whole web UI.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const GEN = path.join(ROOT, 'build', '.gen');

const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old — SEA packaging needs Node 20+.`);
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.rmSync(GEN, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(GEN, { recursive: true });

// 1. Embed the web UI: generate a module that stuffs public/ file contents
//    into a global the server checks before hitting the filesystem.
const embedded = {};
for (const file of fs.readdirSync(path.join(ROOT, 'public'))) {
  embedded[file] = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
}
fs.writeFileSync(
  path.join(GEN, 'embed.mjs'),
  `import path from 'node:path';
globalThis.__APP_DIR__ = path.dirname(process.execPath);
globalThis.__EMBEDDED_PUBLIC__ = ${JSON.stringify(embedded)};
`
);
fs.writeFileSync(
  path.join(GEN, 'entry.mjs'),
  `import './embed.mjs';\nimport '../../server.js';\n`
);

// 2. Bundle to a single CommonJS file (SEA requires CJS).
console.log('\n[1/3] Bundling with esbuild…');
run(
  `npx --yes esbuild@0.24.2 "${path.join(GEN, 'entry.mjs')}" --bundle --platform=node ` +
  `--format=cjs --outfile="${path.join(DIST, 'app.cjs')}" --log-level=warning ` +
  `--legal-comments=none`
);

// 3. Generate the SEA blob and inject it into a copy of the Node binary.
console.log('[2/3] Generating SEA blob…');
const seaConfig = {
  main: path.join(DIST, 'app.cjs'),
  output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true
};
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify(seaConfig));
run(`node --experimental-sea-config "${path.join(DIST, 'sea-config.json')}"`);

console.log('[3/3] Injecting into Node binary…');
const exeName = process.platform === 'win32' ? 'LoLCompanion.exe' : 'LoLCompanion';
const exePath = path.join(DIST, exeName);
fs.copyFileSync(process.execPath, exePath);
fs.chmodSync(exePath, 0o755);
if (process.platform === 'darwin') {
  try { run(`codesign --remove-signature "${exePath}"`); } catch { /* optional */ }
}
run(
  `npx --yes postject@1.0.0-alpha.6 "${exePath}" NODE_SEA_BLOB "${path.join(DIST, 'sea-prep.blob')}" ` +
  `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` +
  (process.platform === 'darwin' ? ' --macho-segment-name NODE_SEA' : '')
);
if (process.platform === 'darwin') {
  try { run(`codesign --sign - "${exePath}"`); } catch { /* ad-hoc resign */ }
}

// Tidy up intermediates so dist/ holds just the deliverable.
for (const f of ['app.cjs', 'sea-prep.blob', 'sea-config.json']) {
  fs.rmSync(path.join(DIST, f), { force: true });
}
fs.rmSync(GEN, { recursive: true, force: true });

const mb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\nDone: ${path.relative(process.cwd(), exePath)} (${mb} MB)`);
console.log('Double-click it — config.json and the match cache are created next to it.');
