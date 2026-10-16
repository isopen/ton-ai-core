import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('.', import.meta.url));
const agent = resolve(scripts, '..');
const root = resolve(scripts, '..', '..', '..');
const libDir = join(agent, 'tgcloud', 'lib');
const coreDir = join(root, 'packages', 'core');
const coreDist = join(coreDir, 'dist');
const coreSrc = join(coreDir, 'src');

function shaFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' });
}

function guard(name, body, extra = []) {
  if (!body.includes('export')) {
    console.error(`sync failed: ${name} has no exports`);
    process.exit(1);
  }
  const bad = [/require\s*\(/, /exports\./, /node:/, /\bprocess\./, /\bBuffer\b/, /from\s+['"]@/, /from\s+['"]node/];
  for (const pattern of [...bad, ...extra]) {
    if (pattern.test(body)) {
      console.error(`sync failed: ${name} contains ${pattern}`);
      process.exit(1);
    }
  }
}

function resolveSpec(absDir, spec) {
  if (spec.endsWith('.js')) return spec;
  if (existsSync(join(absDir, `${spec}.js`))) return `${spec}.js`;
  if (existsSync(join(absDir, spec, 'index.js'))) return `${spec}/index.js`;
  console.error(`sync failed: cannot resolve ${spec} from ${absDir}`);
  process.exit(1);
}

function addJsExtensions(body, absDir) {
  const rewrite = (match, head, spec, quote) => `${head}${resolveSpec(absDir, spec)}${quote}`;
  return body.replace(
    /((?:import|export)[^'"]*?\bfrom\s*['"])(\.\.?\/[^'"]+)(['"])/g,
    rewrite,
  ).replace(
    /(^\s*import\s+['"])(\.\.?\/[^'"]+)(['"])/gm,
    rewrite,
  );
}

function collectJsFiles(dir, base = '') {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full, rel));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.js.map')) {
      out.push(rel);
    } else if (!entry.name.endsWith('.map') && !entry.name.endsWith('.d.ts')) {
      console.error(`sync failed: unexpected file in core dist: ${rel}`);
      process.exit(1);
    }
  }
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'tgcloud-sync-'));
try {
  sh('npm run build -w @ton-ai/core --silent');
  const corePkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8'));

  const esmDir = join(tmp, 'esm');
  execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p', join(coreDir, 'tsconfig.json'),
      '--module', 'es2022',
      '--moduleResolution', 'bundler',
      '--target', 'es2022',
      '--outDir', esmDir,
      '--declaration', 'false',
      '--declarationMap', 'false',
      '--sourceMap', 'false',
    ],
    { stdio: 'inherit' },
  );

  const treeDest = join(libDir, 'ton-ai-core');
  const appVendorDest = join(agent, 'app', 'vendor', 'ton-ai-core');
  rmSync(treeDest, { recursive: true, force: true });
  rmSync(appVendorDest, { recursive: true, force: true });
  const rels = collectJsFiles(esmDir);
  if (rels.length === 0) {
    console.error('sync failed: ESM compile produced no files');
    process.exit(1);
  }
  for (const rel of rels) {
    const body = addJsExtensions(readFileSync(join(esmDir, rel), 'utf8'), join(esmDir, dirname(rel)));
    guard(`ton-ai-core/${rel}`, body);
    const srcRel = rel.replace(/\.js$/, '.ts');
    let srcHash = 'n/a';
    try {
      srcHash = shaFile(join(coreSrc, srcRel));
    } catch {
      console.error(`sync failed: no source for dist file ${rel}`);
      process.exit(1);
    }
    const lines = [
      '// GENERATED from @ton-ai/core dist — do not edit by hand.',
      `// core: ${corePkg.name}@${corePkg.version}`,
      `// dist: ${rel}@${shaFile(join(coreDist, rel))}`,
      `// src: ${srcRel}@${srcHash}`,
    ];
    const header = `${lines.join('\n')}\n// Regenerate: npm run sync -w @ton-ai/tgcloud-agent\n${body}`;
    const dest = join(treeDest, rel);
    mkdirSync(join(treeDest, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(dest, header);
    const vendorDest = join(appVendorDest, rel);
    mkdirSync(join(appVendorDest, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(vendorDest, header);
  }
  console.log(`ton-ai-core tree synced (${rels.length} files)`);

  for (const stale of ['base-plugin.js', 'plugin.js', 'skills.js', 'labels.js']) {
    try {
      rmSync(join(libDir, stale));
      console.log(`stale lib/${stale} removed`);
    } catch { /* already gone */ }
  }

  const pluginSrc = join(root, 'plugins', 'tgcloud-hello', 'src');
  const pluginPkg = JSON.parse(readFileSync(join(root, 'plugins', 'tgcloud-hello', 'package.json'), 'utf8'));

  const pluginOut = join(tmp, 'plugin');
  execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      join(pluginSrc, 'index.ts'),
      '--ignoreConfig',
      '--outDir', pluginOut,
      '--rootDir', pluginSrc,
      '--module', 'es2022',
      '--target', 'es2022',
      '--lib', 'es2022',
      '--types', 'node',
      '--moduleResolution', 'bundler',
      '--declaration', 'false',
      '--sourceMap', 'false',
      '--skipLibCheck',
    ],
    { stdio: 'inherit' },
  );

  const pluginDir = join(libDir, 'tgcloud-hello');
  mkdirSync(pluginDir, { recursive: true });
  rmSync(join(pluginDir, 'plugin.js'), { force: true });

  const units = [
    {
      name: 'labels.js',
      body: readFileSync(join(pluginOut, 'labels.js'), 'utf8'),
      provenance: [
        `plugin: ${pluginPkg.name}@${pluginPkg.version}`,
        `src: labels.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'labels.ts'))}`,
      ],
    },
    {
      name: 'skills.js',
      body: readFileSync(join(pluginOut, 'skills.js'), 'utf8'),
      provenance: [
        `plugin: ${pluginPkg.name}@${pluginPkg.version}`,
        `src: skills.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'skills.ts'))}`,
        `src: labels.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'labels.ts'))}`,
      ],
    },
    {
      name: 'types.js',
      body: readFileSync(join(pluginOut, 'types.js'), 'utf8'),
      provenance: [
        `plugin: ${pluginPkg.name}@${pluginPkg.version}`,
        `src: types.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'types.ts'))}`,
      ],
    },
    {
      name: 'index.js',
      body: readFileSync(join(pluginOut, 'index.js'), 'utf8')
        .replace(/from\s+(['"])@ton-ai\/core\1/g, "from '../ton-ai-core/plugin/base-plugin.js'")
        .split('\n')
        .filter((line) => !/^export \* from ['"]\.\/types(\.js)?['"];$/.test(line.trim()))
        .join('\n'),
      provenance: [
        `plugin: ${pluginPkg.name}@${pluginPkg.version}`,
        `src: index.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'index.ts'))}`,
        `src: skills.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'skills.ts'))}`,
        `src: labels.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'labels.ts'))}`,
        `src: types.ts@${shaFile(join(root, 'plugins', 'tgcloud-hello', 'src', 'types.ts'))}`,
      ],
      extra: [/@ton-ai\/core/, /from\s+['"]\.\/types/, /require\s*\(|exports\./],
      must: ['export class TgcloudHelloPlugin', "from '../ton-ai-core/plugin/base-plugin.js'", "from './skills.js'"],
    },
  ];

  for (const unit of units) {
    guard(unit.name, unit.body, unit.extra ?? []);
    for (const marker of unit.must ?? []) {
      if (!unit.body.includes(marker)) {
        console.error(`sync failed: ${unit.name} is missing ${marker}`);
        process.exit(1);
      }
    }
    const lines = ['// GENERATED from the plugin sources — do not edit by hand.', ...unit.provenance.map((p) => `// ${p}`)];
    writeFileSync(join(pluginDir, unit.name), `${lines.join('\n')}\n// Regenerate: npm run sync -w @ton-ai/tgcloud-agent\n${unit.body}`);
    console.log(`${unit.name} synced`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
