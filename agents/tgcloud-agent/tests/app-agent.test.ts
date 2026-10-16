import { strict as assert } from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_DIR = join(__dirname, '..');
const LIB_TREE = join(AGENT_DIR, 'tgcloud', 'lib', 'ton-ai-core');
const APP_TREE = join(AGENT_DIR, 'app', 'vendor', 'ton-ai-core');
const APP_JS = join(AGENT_DIR, 'app', 'app.js');

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

function runModule(lines: string[]): string {
    return execFileSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], { encoding: 'utf8' }).trim();
}

function appProbe(setup: string[]): string {
    const appUrl = pathToFileURL(APP_JS).href;
    return runModule([
        'const clicks = [];',
        "const el = { textContent: 'Hello, world!', classList: { add() {}, remove() {} } };",
        "const hint = { textContent: 'tap anywhere to switch' };",
        ...setup,
        'globalThis.document = {',
        "  getElementById(id) { return id === 'label' ? el : hint; },",
        '  body: { addEventListener(t, fn) { clicks.push(fn); }, removeEventListener() {} },',
        '};',
        'globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };',
        `await import(${JSON.stringify(appUrl)});`,
        'await new Promise((r) => setTimeout(r, 50));',
        'clicks[0]();',
        'await new Promise((r) => setTimeout(r, 400));',
        'console.log(JSON.stringify([el.textContent, hint.textContent]));',
    ]);
}

describe('tgcloud-agent mini app on the framework agent', () => {
    test('app vendor mirrors the lib framework tree byte for byte', () => {
        assert.ok(existsSync(LIB_TREE), 'lib tree must exist: run npm run sync');
        const libFiles = collect(LIB_TREE);
        assert.ok(libFiles.length > 0, 'lib tree must exist: run npm run sync');
        assert.deepEqual(collect(APP_TREE), libFiles);
        for (const rel of libFiles) {
            assert.equal(
                readFileSync(join(APP_TREE, rel), 'utf8'),
                readFileSync(join(LIB_TREE, rel), 'utf8'),
                `${rel} differs: run npm run sync`,
            );
        }
    });

    test('app.js runs on the vendored agent and stays browser-clean', () => {
        const text = readFileSync(APP_JS, 'utf8');
        assert.ok(text.includes("from './vendor/ton-ai-core/agent/index.js'"), 'must import the vendored agent');
        assert.ok(text.includes('extends BaseAgent'), 'must subclass BaseAgent');
        assert.ok(!text.includes('../tgcloud'), 'must not reach outside app/');
        for (const bad of [/node:/, /require\s*\(/, /\bprocess\./, /\bBuffer\b/, /from\s+['"]@/, /from\s+['"]node/]) {
            assert.ok(!bad.test(text), `app.js must be browser-safe: ${bad}`);
        }
    });

    test('vendored agent arms in a plain runtime', () => {
        const url = pathToFileURL(join(APP_TREE, 'agent', 'index.js')).href;
        const stdout = runModule([
            `import { BaseAgent } from ${JSON.stringify(url)};`,
            'class Probe extends BaseAgent {',
            '  async onInitialize() {}',
            '  async onStart() {}',
            '  async onStop() {}',
            '}',
            "const agent = new Probe({ name: 'probe' });",
            'await agent.initialize();',
            'await agent.start();',
            'const running = agent.getStatus().isRunning;',
            'await agent.stop();',
            'console.log(JSON.stringify([running, agent.getStatus().isRunning]));',
        ]);
        assert.deepEqual(JSON.parse(stdout), [true, false]);
    });

    test('app.js switches the label through the bridge', () => {
        const stdout = appProbe([
            'const webApp = {',
            '  ready() {},',
            '  expand() {},',
            '  Serverless: { call(m, p, done) { done(null, { label: "Let\'s do IT" }); } },',
            '  HapticFeedback: { impactOccurred() {} },',
            '};',
            'globalThis.window = { Telegram: { WebApp: webApp } };',
        ]);
        assert.deepEqual(JSON.parse(stdout), ["Let's do IT", 'tap anywhere to switch']);
    });

    test('app.js reports bridge failures next to the cause', () => {
        const stdout = appProbe([
            'const webApp = {',
            '  ready() {},',
            '  expand() {},',
            '  Serverless: { call(m, p, done) { done(new Error(\'boom\')); } },',
            '  HapticFeedback: { impactOccurred() {} },',
            '};',
            'globalThis.window = { Telegram: { WebApp: webApp } };',
        ]);
        assert.deepEqual(JSON.parse(stdout), ['Hello, world!', 'boom']);
    });

    test('app.js without Telegram keeps the skill message', () => {
        const stdout = appProbe([]);
        assert.deepEqual(JSON.parse(stdout), ['Hello, world!', 'open me inside Telegram to switch via skill']);
    });
});
