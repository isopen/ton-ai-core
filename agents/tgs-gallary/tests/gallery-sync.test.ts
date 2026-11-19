import { strict as assert } from 'assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_DIR = join(__dirname, '..');
const ROOT = join(AGENT_DIR, '..', '..');
const LIB_CORE = join(AGENT_DIR, 'tgcloud', 'lib', 'ton-ai-core');
const APP_CORE = join(AGENT_DIR, 'app', 'vendor', 'ton-ai-core');
const APP_ATOM = join(AGENT_DIR, 'app', 'vendor', 'atom');
const APP_TGS = join(AGENT_DIR, 'app', 'vendor', 'tgs');
const APP_FIXTURES = join(AGENT_DIR, 'app', 'fixtures');
const EMOJI_SRC = process.env.TGS_FIXTURES_DIR
    ? process.env.TGS_FIXTURES_DIR
    : join(process.env.HOME || '', 'Documents', 'tgs_data');
const PLUGIN_WASM = join(ROOT, 'plugins', 'tgs', 'src', 'rust', 'wasm');

function collect(dir: string, base = ''): string[] {
    const out: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a: Dirent, b: Dirent) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...collect(join(dir, entry.name), rel));
        else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}

function collectAll(dir: string, base = ''): string[] {
    const out: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a: Dirent, b: Dirent) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...collectAll(join(dir, entry.name), rel));
        else out.push(rel);
    }
    return out;
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function runModule(lines: string[]): string {
    return execFileSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    }).trim();
}

describe('tgs-gallary generated tree', () => {
    test('core vendor mirrors the isolate tree byte for byte', () => {
        assert.ok(existsSync(LIB_CORE), 'missing tgcloud/lib/ton-ai-core: run npm run sync');
        const rels = collect(LIB_CORE);
        assert.ok(rels.length > 0, 'empty core tree: run npm run sync');
        assert.deepEqual(collect(APP_CORE), rels);
        for (const rel of rels) {
            assert.equal(
                readFileSync(join(APP_CORE, rel), 'utf8'),
                readFileSync(join(LIB_CORE, rel), 'utf8'),
                `${rel} differs: run npm run sync`,
            );
        }
    });

    test('atom is vendored as browser ESM without npm imports', () => {
        assert.ok(existsSync(APP_ATOM), 'missing app/vendor/atom: run npm run sync');
        const rels = collect(APP_ATOM);
        for (const must of ['index.js', 'jsx-runtime.js', 'render.js', 'hooks.js', 'gram-debug.js']) {
            assert.ok(rels.includes(must), `atom vendor is missing ${must}`);
        }
        for (const rel of rels) {
            const text = readFileSync(join(APP_ATOM, rel), 'utf8');
            assert.ok(!/from\s+['"]@ton-ai\//.test(text), `${rel} keeps an npm import`);
            assert.ok(!/require\s*\(/.test(text), `${rel} is not ESM`);
        }
        const stdout = runModule([
            `import { h, render } from ${JSON.stringify(pathToFileURL(join(APP_ATOM, 'index.js')).href)};`,
            `import { useState } from ${JSON.stringify(pathToFileURL(join(APP_ATOM, 'hooks.js')).href)};`,
            'console.log(JSON.stringify([typeof h, typeof render, typeof useState]));',
        ]);
        assert.deepEqual(JSON.parse(stdout), ['function', 'function', 'function']);
    });

    test('tgs wasm renderer is vendored next to the page', () => {
        const glue = join(APP_TGS, 'tgs_wasm.js');
        const wasm = join(APP_TGS, 'tgs_wasm_bg.wasm');
        assert.ok(existsSync(glue), 'missing vendored tgs_wasm.js: run npm run sync');
        assert.ok(existsSync(wasm), 'missing vendored tgs_wasm_bg.wasm: run npm run sync');
        assert.equal(sha(wasm), sha(join(PLUGIN_WASM, 'tgs_wasm_bg.wasm')), 'stale wasm copy: run npm run sync');
        const text = readFileSync(glue, 'utf8');
        assert.ok(text.includes('export class TgsRender'), 'glue must export TgsRender');
        assert.ok(text.includes('export async function init'), 'glue must export init');
        assert.ok(text.includes('tgs_wasm_bg.wasm'), 'glue must resolve the wasm asset');
    });

    test('emoji files are packed into static shards under the 1000-file limit', () => {
        assert.ok(existsSync(APP_FIXTURES), 'missing app/fixtures: run npm run sync');
        const files = collectAll(APP_FIXTURES);
        assert.ok(files.includes('manifest.js'), 'missing app/fixtures/manifest.js: run npm run sync');
        assert.deepEqual(files.filter((f) => f.endsWith('.json')), [], 'app/fixtures must not contain json');
        assert.deepEqual(files.filter((f) => f.endsWith('.tgs')), [], 'app/fixtures must not contain loose .tgs');
        const shards = files.filter((f) => /^data\/shard-\d{3}\.bin$/.test(f));
        assert.ok(shards.length > 0, 'empty app/fixtures/data: run npm run sync');
        assert.equal(files.length, shards.length + 1);

        const stdout = runModule([
            `import { PACKS, COUNT, BYTES, SHARDS, EMPTY, BUILD } from ${JSON.stringify(pathToFileURL(join(APP_FIXTURES, 'manifest.js')).href)};`,
            'let n = 0; const names = []; const entries = [];',
            'for (const [pack, items] of PACKS) { names.push(pack); n += items.length; for (const it of items) entries.push([pack, ...it]); }',
            'console.log(JSON.stringify({ n, COUNT, BYTES, SHARDS, EMPTY, BUILD, names, entries }));',
        ]);
        const manifest = JSON.parse(stdout) as {
            n: number;
            COUNT: number;
            BYTES: number;
            SHARDS: number;
            EMPTY: string[];
            BUILD: string;
            names: string[];
            entries: [string, string, string, number, string, number, number][];
        };
        assert.equal(manifest.n, manifest.COUNT);
        assert.equal(manifest.SHARDS, shards.length);
        assert.match(manifest.BUILD, /^[0-9a-f]{12}$/);
        assert.ok(Array.isArray(manifest.EMPTY), 'EMPTY must list skipped emoji');
        const listed = new Set(manifest.entries.map(([pack, id]) => `${pack}/${id}`));
        for (const id of manifest.EMPTY) {
            assert.ok(!listed.has(id), `${id} is both listed and skipped`);
            assert.match(id, /^[^/]+\/[^/]+$/);
        }

        const staticFiles = collectAll(join(AGENT_DIR, 'app')).length;
        assert.ok(staticFiles < 1000, `app/ has ${staticFiles} files, the cloud limit is 1000`);

        const shardNames = new Set(shards.map((rel) => rel.replace(/^data\//, '')));
        const byShard = new Map<string, { offset: number; size: number }[]>();
        let sum = 0;
        for (const [pack, id, sticker, fr, shard, offset, size] of manifest.entries) {
            assert.ok(pack && id, 'manifest entry lost its pack or id');
            assert.ok(typeof sticker === 'string');
            assert.ok(shardNames.has(shard), `unknown shard ${shard}`);
            assert.ok(Number.isInteger(offset) && offset >= 0, `bad offset for ${pack}/${id}`);
            assert.ok(Number.isInteger(size) && size > 0, `bad size for ${pack}/${id}`);
            assert.ok(Number.isInteger(fr) && fr > 0, `bad fr for ${pack}/${id}`);
            sum += size;
            const list = byShard.get(shard) || [];
            list.push({ offset, size });
            byShard.set(shard, list);
        }
        assert.equal(sum, manifest.BYTES);

        for (const [shard, list] of byShard) {
            list.sort((a, b) => a.offset - b.offset);
            let end = 0;
            for (const entry of list) {
                assert.equal(entry.offset, end, `${shard} has a gap or overlap`);
                end += entry.size;
            }
            assert.ok(list.length <= 128, `${shard} packs too many files`);
            assert.equal(end, statSync(join(APP_FIXTURES, 'data', shard)).size, `${shard} size mismatch`);
        }

        if (existsSync(EMOJI_SRC)) {
            const srcDirs = readdirSync(EMOJI_SRC, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name)
                .sort();
            const skipped = new Set(manifest.EMPTY);
            const keptDirs = srcDirs.filter((dir) =>
                readdirSync(join(EMOJI_SRC, dir)).some((n) => n.endsWith('.tgs') && !skipped.has(`${dir}/${n.slice(0, -4)}`)));
            assert.equal(manifest.names.slice().sort().join('\n'), keptDirs.join('\n'));
            let srcCount = 0;
            for (const dir of srcDirs) {
                srcCount += readdirSync(join(EMOJI_SRC, dir)).filter((n) => n.endsWith('.tgs')).length;
            }
            assert.equal(srcCount, manifest.COUNT + manifest.EMPTY.length);
            for (const id of manifest.EMPTY) {
                const [pack, file] = id.split('/');
                assert.ok(existsSync(join(EMOJI_SRC, pack, file + '.tgs')), `missing skipped source ${id}`);
            }

            const step = Math.max(1, Math.floor(manifest.entries.length / 40));
            for (let i = 0; i < manifest.entries.length; i += step) {
                const [pack, id, , , shard, offset, size] = manifest.entries[i];
                const source = readFileSync(join(EMOJI_SRC, pack, id + '.tgs'));
                const packed = readFileSync(join(APP_FIXTURES, 'data', shard)).subarray(offset, offset + size);
                assert.equal(size, source.length, `${pack}/${id} size mismatch`);
                assert.equal(Buffer.compare(source, packed), 0, `${pack}/${id} bytes mismatch`);
            }
        }

        const generated = readFileSync(join(AGENT_DIR, 'tgcloud', 'lib', 'fixtures.js'), 'utf8');
        assert.ok(generated.includes(`FIXTURE_COUNT = ${manifest.COUNT}`));
        assert.ok(generated.includes(`FIXTURE_BYTES = ${manifest.BYTES}`));
        assert.ok(generated.includes(`FIXTURE_EMPTY = ${manifest.EMPTY.length}`));
    });

    test('cloud modules stay isolate-clean', () => {
        const out = execFileSync(process.execPath, [join(AGENT_DIR, 'scripts', 'check-clean.mjs')], {
            encoding: 'utf8',
        });
        assert.ok(out.includes('isolate-clean'));
    });
});
