import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scripts = fileURLToPath(new URL('.', import.meta.url));
const agent = resolve(scripts, '..');
const root = resolve(scripts, '..', '..', '..');
const libDir = join(agent, 'tgcloud', 'lib');
const appDir = join(agent, 'app');
const coreDir = join(root, 'packages', 'core');
const coreDist = join(coreDir, 'dist');
const coreSrc = join(coreDir, 'src');
const atomDir = join(root, 'plugins', 'atom');
const atomSrc = join(atomDir, 'src');
const tgsWasmDir = join(root, 'plugins', 'tgs', 'src', 'rust', 'wasm');
const fixturesSrc = process.env.TGS_FIXTURES_DIR
    ? resolve(process.env.TGS_FIXTURES_DIR)
    : join(homedir(), 'Documents', 'tgs_data');

const shaFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function sh(cmd) {
    execSync(cmd, { cwd: root, encoding: 'utf8' });
}

function guard(name, body, extra = []) {
    if (!body.includes('export')) {
        console.error(`sync failed: ${name} has no exports`);
        process.exit(1);
    }
    const bad = [/require\s*\(/, /exports\./, /['"]node:/, /\bprocess\./, /\bBuffer\b/, /from\s+['"]@/, /from\s+['"]node/];
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
            console.error(`sync failed: unexpected file in dist: ${rel}`);
            process.exit(1);
        }
    }
    return out;
}

function writeTree(destRoot, rel, body, header) {
    const dest = join(destRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, header ? `${header}\n${body}` : body);
}

const tmp = mkdtempSync(join(tmpdir(), 'tgs-gallary-sync-'));
try {
    sh('npm run build -w @ton-ai/core --silent');
    const corePkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8'));

    const coreEsm = join(tmp, 'core-esm');
    execFileSync(
        process.execPath,
        [
            resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
            '-p', join(coreDir, 'tsconfig.json'),
            '--module', 'es2022',
            '--moduleResolution', 'bundler',
            '--target', 'es2022',
            '--outDir', coreEsm,
            '--declaration', 'false',
            '--declarationMap', 'false',
            '--sourceMap', 'false',
        ],
        { stdio: 'inherit' },
    );

    const coreLibDest = join(libDir, 'ton-ai-core');
    const coreAppDest = join(appDir, 'vendor', 'ton-ai-core');
    rmSync(coreLibDest, { recursive: true, force: true });
    rmSync(coreAppDest, { recursive: true, force: true });
    const coreRels = collectJsFiles(coreEsm);
    if (coreRels.length === 0) {
        console.error('sync failed: core ESM compile produced no files');
        process.exit(1);
    }
    for (const rel of coreRels) {
        const body = addJsExtensions(readFileSync(join(coreEsm, rel), 'utf8'), join(coreEsm, dirname(rel)));
        guard(`ton-ai-core/${rel}`, body);
        const srcRel = rel.replace(/\.js$/, '.ts');
        if (!existsSync(join(coreSrc, srcRel))) {
            console.error(`sync failed: no source for dist file ${rel}`);
            process.exit(1);
        }
        const header = [
            '// GENERATED from @ton-ai/core dist — do not edit by hand.',
            `// core: ${corePkg.name}@${corePkg.version}`,
            `// dist: ${rel}@${shaFile(join(coreDist, rel))}`,
            `// src: ${srcRel}@${shaFile(join(coreSrc, srcRel))}`,
            '// Regenerate: npm run sync -w @ton-ai/tgs-gallary',
        ].join('\n');
        writeTree(coreLibDest, rel, body, header);
        writeTree(coreAppDest, rel, body, header);
    }
    console.log(`ton-ai-core tree synced (${coreRels.length} files)`);

    const atomPkg = JSON.parse(readFileSync(join(atomDir, 'package.json'), 'utf8'));
    const atomEsm = join(tmp, 'atom-esm');
    execFileSync(
        process.execPath,
        [
            resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
            '-p', join(atomDir, 'tsconfig.json'),
            '--module', 'es2022',
            '--moduleResolution', 'bundler',
            '--target', 'es2022',
            '--outDir', atomEsm,
            '--declaration', 'false',
            '--declarationMap', 'false',
            '--sourceMap', 'false',
        ],
        { stdio: 'inherit' },
    );

    const atomAppDest = join(appDir, 'vendor', 'atom');
    rmSync(atomAppDest, { recursive: true, force: true });
    const atomRels = collectJsFiles(atomEsm);
    if (atomRels.length === 0) {
        console.error('sync failed: atom ESM compile produced no files');
        process.exit(1);
    }
    for (const rel of atomRels) {
        let body = addJsExtensions(readFileSync(join(atomEsm, rel), 'utf8'), join(atomEsm, dirname(rel)));
        body = body.replace(/from\s+['"]@ton-ai\/gram-debug['"]/g, "from './gram-debug.js'");
        guard(`atom/${rel}`, body);
        const srcRel = rel.replace(/\.js$/, '.ts');
        if (!existsSync(join(atomSrc, srcRel))) {
            console.error(`sync failed: no atom source for ${rel}`);
            process.exit(1);
        }
        const header = [
            '// GENERATED from @ton-ai/atom src — do not edit by hand.',
            `// atom: ${atomPkg.name}@${atomPkg.version}`,
            `// src: ${srcRel}@${shaFile(join(atomSrc, srcRel))}`,
            '// Regenerate: npm run sync -w @ton-ai/tgs-gallary',
        ].join('\n');
        writeTree(atomAppDest, rel, body, header);
    }
    writeFileSync(join(atomAppDest, 'gram-debug.js'), [
        '// Browser stub for @ton-ai/gram-debug: Atom only uses getLogger().',
        'const noop = () => {};',
        'const make = () => ({ debug: noop, info: noop, warn: noop, log: noop, error: (...a) => console.error(...a) });',
        'export function getLogger() { return make(); }',
        'export function isEnabled() { return false; }',
        'export default { getLogger, isEnabled };',
        '',
    ].join('\n'));
    console.log(`atom tree synced (${atomRels.length} files + logger stub)`);

    for (const name of ['tgs_wasm.js', 'tgs_wasm_bg.wasm']) {
        const src = join(tgsWasmDir, name);
        if (!existsSync(src)) {
            console.error(`sync failed: missing ${src} — build the tgs plugin wasm first`);
            process.exit(1);
        }
    }
    const tgsDest = join(appDir, 'vendor', 'tgs');
    rmSync(tgsDest, { recursive: true, force: true });
    mkdirSync(tgsDest, { recursive: true });
    const glue = readFileSync(join(tgsWasmDir, 'tgs_wasm.js'), 'utf8');
    writeFileSync(join(tgsDest, 'tgs_wasm.js'), [
        `// GENERATED from plugins/tgs/src/rust/wasm/tgs_wasm.js@${shaFile(join(tgsWasmDir, 'tgs_wasm.js'))}`,
        '// Regenerate: npm run sync -w @ton-ai/tgs-gallary',
        glue,
    ].join('\n'));
    writeFileSync(join(tgsDest, 'tgs_wasm_bg.wasm'), readFileSync(join(tgsWasmDir, 'tgs_wasm_bg.wasm')));
    console.log(`tgs wasm vendored (${statSync(join(tgsDest, 'tgs_wasm_bg.wasm')).size} bytes)`);

    if (!existsSync(fixturesSrc)) {
        console.error(`sync failed: missing emoji folder ${fixturesSrc} — set TGS_FIXTURES_DIR`);
        process.exit(1);
    }
    const fixturesDest = join(appDir, 'fixtures');
    const shardDir = join(fixturesDest, 'data');
    rmSync(fixturesDest, { recursive: true, force: true });
    mkdirSync(shardDir, { recursive: true });

    const SHARD_MAX_FILES = 128;
    const SHARD_MAX_BYTES = 2 * 1024 * 1024;
    let shardIndex = -1;
    let shardName = '';
    let shardChunks = [];
    let shardBytes = 0;
    let shardCount = 0;
    const flushShard = () => {
        if (shardChunks.length === 0) return;
        writeFileSync(join(shardDir, shardName), Buffer.concat(shardChunks));
        shardChunks = [];
        shardBytes = 0;
        shardCount = 0;
    };
    const addToShard = (data) => {
        if (shardCount > 0 && (shardCount >= SHARD_MAX_FILES || shardBytes + data.length > SHARD_MAX_BYTES)) {
            flushShard();
        }
        if (shardChunks.length === 0) {
            shardIndex++;
            shardName = 'shard-' + String(shardIndex).padStart(3, '0') + '.bin';
        }
        const offset = shardBytes;
        shardChunks.push(data);
        shardBytes += data.length;
        shardCount++;
        return { shard: shardName, offset, size: data.length };
    };

    const COLOR_OBJECT = /"c"\s*:\s*\{([^{}]*)\}/g;
    const COLOR_ARRAY = /"c"\s*:\s*\[([^\]]*)\]/g;
    const STATIC_COLOR = /"k"\s*:\s*\[([^\]]*)\]/;
    const alphaOf = (parts) => {
        const nums = parts.split(',').map((v) => Number(v.trim()));
        if (nums.length < 4) return 1;
        return Number.isFinite(nums[3]) ? nums[3] : 1;
    };
    const mayRender = (text) => {
        if (/"ef"\s*:\s*\[/.test(text)) return true;
        if (/"ty"\s*:\s*[025]\s*[,}]/.test(text)) return true;
        let found = false;
        let match;
        COLOR_OBJECT.lastIndex = 0;
        while ((match = COLOR_OBJECT.exec(text))) {
            found = true;
            const body = match[1];
            if (/"a"\s*:\s*1/.test(body)) return true;
            const color = STATIC_COLOR.exec(body);
            if (!color) return true;
            if (alphaOf(color[1]) > 0.0001) return true;
        }
        COLOR_ARRAY.lastIndex = 0;
        while ((match = COLOR_ARRAY.exec(text))) {
            found = true;
            if (alphaOf(match[1]) > 0.0001) return true;
        }
        return !found;
    };

    let tgsModule = null;
    const rendersAnything = async (json) => {
        if (!tgsModule) {
            tgsModule = await import(pathToFileURL(join(tgsWasmDir, 'tgs_wasm.js')).href);
            await tgsModule.default();
        }
        let anim = null;
        try {
            anim = new tgsModule.TgsRender(json, 64, 64);
            const frames = anim.frame_count();
            const base = anim.in_frame();
            for (let frame = 0; frame < frames; frame++) {
                anim.render(base + frame, 64, 64);
                const pixels = new Uint8Array(tgsModule.getMemory().buffer, anim.data_ptr(), anim.data_len());
                for (let i = 3; i < pixels.length; i += 4) {
                    if (pixels[i]) return true;
                }
            }
            return false;
        } finally {
            if (anim) {
                try { anim.free(); } catch { }
            }
        }
    };
    const empty = [];

    const meta = new Map();
    const metaFile = join(fixturesSrc, 'manifest.jsonl');
    if (existsSync(metaFile)) {
        for (const line of readFileSync(metaFile, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const row = JSON.parse(line);
                if (row && row.docId) meta.set(String(row.docId), row);
            } catch { }
        }
    }

    const packs = [];
    let total = 0;
    let bytes = 0;
    const corpusHash = createHash('sha256');
    const byName = (a, b) => (a.name < b.name ? -1 : 1);
    for (const dir of readdirSync(fixturesSrc, { withFileTypes: true }).sort(byName)) {
        if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
        const packSrc = join(fixturesSrc, dir.name);
        const items = [];
        for (const entry of readdirSync(packSrc, { withFileTypes: true }).sort(byName)) {
            if (!entry.isFile() || !entry.name.endsWith('.tgs')) continue;
            const id = entry.name.slice(0, -4);
            const data = readFileSync(join(packSrc, entry.name));
            corpusHash.update(data);
            let text = '';
            try {
                text = data[0] === 0x1f && data[1] === 0x8b
                    ? gunzipSync(data).toString('utf8')
                    : data.toString('utf8');
            } catch { }
            if (text && !mayRender(text) && !(await rendersAnything(text))) {
                empty.push(`${dir.name}/${id}`);
                continue;
            }
            const loc = addToShard(data);
            let fr = 60;
            const match = /"fr"\s*:\s*([0-9.]+)/.exec(text.slice(0, 256));
            if (match) fr = Math.max(1, Math.round(Number(match[1])));
            const row = meta.get(id);
            items.push([id, row && row.sticker ? row.sticker : '', fr, loc.shard, loc.offset, loc.size]);
            total++;
            bytes += data.length;
        }
        if (items.length === 0) continue;
        packs.push([dir.name, items]);
    }
    flushShard();
    if (total === 0) {
        console.error(`sync failed: no *.tgs emoji in ${fixturesSrc}`);
        process.exit(1);
    }
    const build = createHash('sha256')
        .update(corpusHash.digest())
        .update(JSON.stringify(packs))
        .digest('hex')
        .slice(0, 12);

    writeFileSync(join(fixturesDest, 'manifest.js'), [
        'export const PACKS = [',
        packs.map((pack) => JSON.stringify(pack)).join(',\n'),
        '];',
        `export const COUNT = ${total};`,
        `export const BYTES = ${bytes};`,
        `export const SHARDS = ${shardIndex + 1};`,
        `export const EMPTY = ${JSON.stringify(empty)};`,
        `export const BUILD = '${build}';`,
        '',
    ].join('\n'));

    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'fixtures.js'), [
        `export const PACKS = ${JSON.stringify(packs.map((pack) => pack[0]))};`,
        `export const FIXTURE_COUNT = ${total};`,
        `export const FIXTURE_BYTES = ${bytes};`,
        `export const FIXTURE_EMPTY = ${empty.length};`,
        'export function fixtureStats() {',
        '    return { count: FIXTURE_COUNT, bytes: FIXTURE_BYTES, packs: PACKS.length, empty: FIXTURE_EMPTY, names: PACKS };',
        '}',
        '',
    ].join('\n'));
    console.log(`emoji shards synced (${shardIndex + 1} shards, ${packs.length} packs, ${total} files, ${bytes} bytes)`);
    if (empty.length > 0) {
        console.log(`skipped ${empty.length} empty emoji: ${empty.join(', ')}`);
    }
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
