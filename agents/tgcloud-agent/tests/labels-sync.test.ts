import { strict as assert } from 'assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { getLabels, TgcloudHelloSkills } from '@ton-ai/tgcloud-hello';

const LIB = join(__dirname, '..', 'tgcloud', 'lib');
const TGCLOUD = join(__dirname, '..', 'tgcloud');
const PLUGIN_SRC = join(__dirname, '..', '..', '..', 'plugins', 'tgcloud-hello', 'src');

function sha(path: string): string {
    return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex');
}

function vendored(name: string): string {
    return readFileSync(join(LIB, 'tgcloud-hello', name), 'utf8');
}

describe('tgcloud-agent vendored chain', () => {
    test('labels.js comes from the plugin sources', () => {
        const text = vendored('labels.js');
        assert.ok(
            text.includes('GENERATED from the plugin sources'),
            'vendored copy must come from src: regenerate with npm run sync',
        );
        assert.ok(
            text.includes('plugin: @ton-ai/tgcloud-hello@'),
            'vendored copy must record its source plugin',
        );
        assert.ok(
            text.includes(`labels.ts@${sha(join(PLUGIN_SRC, 'labels.ts'))}`),
            'vendored copy is stale: regenerate with npm run sync',
        );
        for (const label of getLabels()) {
            assert.ok(text.includes(label), `vendored copy is missing ${label}`);
        }
        assert.ok(text.includes('export function nextLabel'), 'vendored copy must export nextLabel');
    });

    test('skills.js is pinned to the plugin skill source hashes', () => {
        const text = vendored('skills.js');
        assert.ok(text.includes(`skills.ts@${sha(join(PLUGIN_SRC, 'skills.ts'))}`), 'stale: run sync');
        assert.ok(text.includes(`labels.ts@${sha(join(PLUGIN_SRC, 'labels.ts'))}`), 'stale: run sync');
        assert.ok(text.includes('export class TgcloudHelloSkills'), 'must export TgcloudHelloSkills');
        assert.ok(text.includes("from './labels.js'"), 'must use relative .js imports');
    });

    test('types.js mirrors the plugin shared types', () => {
        const text = vendored('types.js');
        assert.ok(text.includes(`types.ts@${sha(join(PLUGIN_SRC, 'types.ts'))}`), 'stale: run sync');
        assert.ok(text.includes('export'), 'must stay an ES module');
        assert.ok(!text.includes('@ton-ai/core'), 'must not keep the framework import');
        for (const bad of [/require\s*\(/, /exports\./, /node:/, /\bprocess\./, /\bBuffer\b/]) {
            assert.ok(!bad.test(text), `vendored types must be isolate-clean: ${bad}`);
        }
    });

    test('index.js is pinned to the plugin class sources and is isolate-clean', () => {
        const text = vendored('index.js');
        for (const name of ['index.ts', 'skills.ts', 'labels.ts', 'types.ts']) {
            assert.ok(text.includes(`${name}@${sha(join(PLUGIN_SRC, name))}`), `stale ${name}: run sync`);
        }
        assert.ok(text.includes('export class TgcloudHelloPlugin'), 'must export TgcloudHelloPlugin');
        assert.ok(text.includes("from '../ton-ai-core/plugin/base-plugin.js'"), 'must import the vendored framework');
        assert.ok(text.includes("from './skills.js'"), 'must import the vendored skills');
        assert.ok(text.includes('static async armed'), 'must expose the armed bootstrap');
        assert.ok(!text.includes('@ton-ai/core'), 'must not keep the framework import');
        assert.ok(!text.includes("./types"), 'must not import type-only modules');
        for (const bad of [/require\s*\(/, /exports\./, /node:/, /\bprocess\./, /\bBuffer\b/]) {
            assert.ok(!bad.test(text), `vendored plugin must be isolate-clean: ${bad}`);
        }
    });

    test('ton-ai-core tree mirrors the framework dist', () => {
        const tree = join(LIB, 'ton-ai-core');
        const distDir = join(__dirname, '..', '..', '..', 'packages', 'core', 'dist');
        const collect = (dir: string, base = ''): string[] => {
            const out: string[] = [];
            const entries = readdirSync(dir, { withFileTypes: true }).sort((a: Dirent, b: Dirent) => (a.name < b.name ? -1 : 1));
            for (const entry of entries) {
                const rel = base ? `${base}/${entry.name}` : entry.name;
                if (entry.isDirectory()) out.push(...collect(join(dir, entry.name), rel));
                else if (entry.name.endsWith('.js') && !entry.name.endsWith('.js.map')) out.push(rel);
            }
            return out;
        };
        const distFiles = collect(distDir);
        assert.ok(distFiles.length > 0, 'core dist must exist: run npm run build -w @ton-ai/core');
        assert.ok(
            distFiles.every((rel) => existsSync(join(tree, rel))),
            'every dist file must have a vendored counterpart: run sync',
        );
        const corePkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'core', 'package.json'), 'utf8'));
        for (const rel of distFiles) {
            const text = readFileSync(join(tree, rel), 'utf8');
            assert.ok(
                text.includes(`core: ${corePkg.name}@${corePkg.version}`),
                `${rel} must record the core version`,
            );
            assert.ok(
                text.includes(`dist: ${rel}@${sha(join(distDir, rel))}`),
                `${rel} is stale: run sync`,
            );
        }
        assert.ok(!existsSync(join(LIB, 'base-plugin.js')), 'stale flat base-plugin.js must be gone');
        for (const stale of ['plugin.js', 'skills.js', 'labels.js']) {
            assert.ok(!existsSync(join(LIB, stale)), `stale flat lib/${stale} must be gone`);
        }
    });

    test('cloud modules arm the plugin class', () => {
        for (const name of ['endpoints/nextLabel.js', 'handlers/message.js']) {
            const text = readFileSync(join(TGCLOUD, name), 'utf8');
            assert.ok(text.includes("from '../lib/tgcloud-hello/index.js'"), `${name} must import the vendored plugin`);
            assert.ok(text.includes('await TgcloudHelloPlugin.armed()'), `${name} must arm the plugin`);
            assert.ok(!text.includes("skills.js'"), `${name} must not bypass the plugin`);
        }
        const endpoint = readFileSync(join(TGCLOUD, 'endpoints', 'nextLabel.js'), 'utf8');
        assert.ok(endpoint.includes('plugin.nextLabel(current)'), 'endpoint must delegate to the plugin');
    });

    test('vendored plugin runs and arms in a plain runtime', () => {
        const script = [
            `import { TgcloudHelloPlugin } from ${JSON.stringify(join(LIB, 'tgcloud-hello', 'index.js'))};`,
            'const plugin = await TgcloudHelloPlugin.armed();',
            "const again = await TgcloudHelloPlugin.armed();",
            "console.log(JSON.stringify([plugin === again, plugin.labelAt(0), plugin.nextLabel('Hello, world!'), plugin.getLabels().length]));",
        ].join('\n');
        const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
        });
        assert.deepEqual(JSON.parse(stdout.trim()), [true, 'Hello, world!', "Let's do IT", 3]);
    });

    test('plugin skill behavior reference', async () => {
        const plugin = new TgcloudHelloSkills({ events: {}, logger: {} } as never, {});
        assert.deepEqual(plugin.getLabels(), ['Hello, world!', "Let's do IT", 'Ready to GO!']);
        assert.equal(plugin.nextLabel('Hello, world!'), "Let's do IT");
        assert.equal(plugin.labelAt(0), 'Hello, world!');
    });
});
