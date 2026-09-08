import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

const deps = [
  { dir: 'packages/core', extra: ['dist/crypton/index.js'] },
  { dir: 'plugins/gram-debug', extra: [] },
  { dir: 'plugins/atom', extra: [] },
  { dir: 'plugins/tl-language', extra: [] },
  { dir: 'plugins/mtproto', extra: [] },
  { dir: 'plugins/telegram', extra: [] },
  { dir: 'plugins/tgs', extra: [] },
  { dir: 'plugins/tmd', extra: [] },
  { dir: 'plugins/gram-media', extra: [] },
  { dir: 'plugins/gram-db', extra: [] },
  { dir: 'plugins/gram-lang', extra: [] },
  { dir: 'plugins/gram-ui', extra: [] },
];

let failed = false;

for (const dep of deps) {
  const pkgPath = join(root, dep.dir, 'package.json');
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    console.error('[ensure-deps] missing ' + pkgPath);
    failed = true;
    continue;
  }
  const name = pkg.name || dep.dir;
  const main = pkg.main || 'dist/index.js';
  const markers = [main, ...dep.extra];
  const missing = markers.filter((m) => !existsSync(join(root, dep.dir, m)));
  if (missing.length === 0) continue;
  console.log('[ensure-deps] building ' + name + ' (' + missing.join(', ') + ' missing)');
  try {
    execSync('npm run build -w ' + name, { cwd: root, stdio: 'inherit' });
  } catch {
    failed = true;
    continue;
  }
  const stillMissing = markers.filter((m) => !existsSync(join(root, dep.dir, m)));
  if (stillMissing.length > 0) {
    console.error('[ensure-deps] build did not produce ' + stillMissing.map((m) => dep.dir + '/' + m).join(', '));
    failed = true;
  }
}

if (failed) {
  console.error('[ensure-deps] workspace dependencies incomplete, run make build-gram-browser');
  process.exit(1);
}
