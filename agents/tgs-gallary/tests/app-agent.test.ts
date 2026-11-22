import { strict as assert } from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_DIR = join(__dirname, '..');
const ROOT = join(AGENT_DIR, '..', '..');
const APP = join(AGENT_DIR, 'app');
const APP_JS = join(APP, 'app.js');
const APP_CORE = join(APP, 'vendor', 'ton-ai-core');
const APP_ATOM = join(APP, 'vendor', 'atom');
const HANDLER = join(AGENT_DIR, 'tgcloud', 'handlers', 'message.js');
const ENDPOINT = join(AGENT_DIR, 'tgcloud', 'endpoints', 'fixtureStats.js');

function runModule(lines: string[]): string {
    return execFileSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], {
        encoding: 'utf8',
    }).trim();
}

const url = (path: string) => pathToFileURL(path).href;

describe('tgs-gallary mini app', () => {
    test('app.js runs on the vendored agent, Atom and tgs wasm', () => {
        const text = readFileSync(APP_JS, 'utf8');
        assert.ok(text.includes("from './vendor/ton-ai-core/agent/index.js'"), 'must import the vendored agent');
        assert.ok(text.includes('extends BaseAgent'), 'must subclass BaseAgent');
        assert.ok(text.includes("from './vendor/atom/jsx-runtime.js'"), 'must use Atom for the UI');
        assert.ok(text.includes("from './vendor/tgs/tgs_wasm.js'"), 'must use the vendored tgs renderer');
        assert.ok(text.includes("from './gallery-core.js'"), 'must use the shared pagination helpers');
        assert.ok(text.includes("from './fixtures/manifest.js'"), 'must load the generated emoji packs');
        assert.ok(text.includes('filterFiles'), 'must filter emoji from the search box');
        assert.ok(text.includes('groupByPack'), 'must support grouping by pack');
        assert.ok(text.includes('fileLabel'), 'must give every emoji a unique label');
        assert.ok(text.includes('formatMetrics'), 'must show per-emoji load and render speed');
        assert.ok(text.includes('createCellObserver'), 'must gate animation on viewport visibility');
        assert.ok(text.includes('!visible || !animReady'), 'must not animate offscreen cells');
        assert.ok(text.includes('FpsMeter'), 'must show the current page frame rate');
        assert.ok(!text.includes('FPS_OPTIONS'), 'the frame rate must not be a user setting');
        assert.ok(!text.includes('setFps'), 'the frame rate must not be a user setting');
        assert.ok(text.includes('loadShard'), 'must load emoji from static shards');
        assert.ok(text.includes('Search emoji'), 'must expose a search input');
        assert.ok(text.includes('fixtureStats'), 'must call the cloud skill');
        for (const bad of [/node:/, /require\s*\(/, /\bprocess\./, /\bBuffer\b/, /from\s+['"]@/, /from\s+['"]node/]) {
            assert.ok(!bad.test(text), `app.js must be browser-safe: ${bad}`);
        }
    });

    test('vendored agent arms in a plain runtime', () => {
        const stdout = runModule([
            `import { BaseAgent } from ${JSON.stringify(url(join(APP_CORE, 'agent', 'index.js')))};`,
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

    test('vendored Atom renders and re-renders in jsdom', () => {
        const stdout = runModule([
            'import { createRequire } from "node:module";',
            `const require = createRequire(${JSON.stringify(join(ROOT, 'probe.cjs'))});`,
            'const { JSDOM } = require("jsdom");',
            'const dom = new JSDOM(\'<!doctype html><div id="root"></div>\');',
            'globalThis.window = dom.window;',
            'globalThis.document = dom.window.document;',
            'globalThis.Element = dom.window.Element;',
            'globalThis.HTMLElement = dom.window.HTMLElement;',
            'globalThis.Node = dom.window.Node;',
            'globalThis.Text = dom.window.Text;',
            'globalThis.Comment = dom.window.Comment;',
            'globalThis.SVGElement = dom.window.SVGElement;',
            `const { h } = await import(${JSON.stringify(url(join(APP_ATOM, 'jsx-runtime.js')))});`,
            `const { render } = await import(${JSON.stringify(url(join(APP_ATOM, 'render.js')))});`,
            `const { useState } = await import(${JSON.stringify(url(join(APP_ATOM, 'hooks.js')))});`,
            'function Counter() {',
            '  const [n, setN] = useState(0);',
            "  return h('button', { onClick: () => setN(n + 1) }, 'n=' + n);",
            '}',
            "const root = document.getElementById('root');",
            'render(Counter, root);',
            'await new Promise((r) => setTimeout(r, 20));',
            'const before = root.textContent;',
            "root.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));",
            'await new Promise((r) => setTimeout(r, 20));',
            'console.log(JSON.stringify([before, root.textContent]));',
        ]);
        assert.deepEqual(JSON.parse(stdout), ['n=0', 'n=1']);
    });

    test('size select resolves option text, not option value', () => {
        const stdout = runModule([
            'import { createRequire } from "node:module";',
            `const require = createRequire(${JSON.stringify(join(ROOT, 'probe.cjs'))});`,
            'const { JSDOM } = require("jsdom");',
            'const dom = new JSDOM(\'<!doctype html><div id="root"></div>\');',
            'globalThis.window = dom.window;',
            'globalThis.document = dom.window.document;',
            'globalThis.Element = dom.window.Element;',
            'globalThis.HTMLElement = dom.window.HTMLElement;',
            'globalThis.Node = dom.window.Node;',
            'globalThis.Text = dom.window.Text;',
            'globalThis.Comment = dom.window.Comment;',
            'globalThis.SVGElement = dom.window.SVGElement;',
            'globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);',
            'globalThis.cancelAnimationFrame = (id) => clearTimeout(id);',
            `const { h } = await import(${JSON.stringify(url(join(APP_ATOM, 'jsx-runtime.js')))});`,
            `const { render } = await import(${JSON.stringify(url(join(APP_ATOM, 'render.js')))});`,
            `const { useState } = await import(${JSON.stringify(url(join(APP_ATOM, 'hooks.js')))});`,
            'function Sizes() {',
            '  const [size, setSize] = useState(96);',
            '  return h("div", null, [',
            '    h("select", {',
            '      value: size + " px",',
            '      onChange: (e) => setSize(parseInt(e.target.value, 10)),',
            '    }, [96, 128].map((n) => h("option", null, n + " px"))),',
            '    h("span", null, String(size)),',
            '  ]);',
            '}',
            "const root = document.getElementById('root');",
            'render(Sizes, root);',
            'await new Promise((r) => setTimeout(r, 30));',
            'const select = root.querySelector("select");',
            'const before = [select.value, root.querySelector("span").textContent];',
            'select.value = "128 px";',
            'select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));',
            'await new Promise((r) => setTimeout(r, 30));',
            'const after = [select.value, root.querySelector("span").textContent];',
            'console.log(JSON.stringify([before, after]));',
        ]);
        assert.deepEqual(JSON.parse(stdout), [
            ['96 px', '96'],
            ['128 px', '128'],
        ]);
    });

    test('pagination helpers handle the gallery edges', () => {
        const stdout = runModule([
            `import { pageCount, clampPage, pageSlice, formatRange } from ${JSON.stringify(url(join(APP, 'gallery-core.js')))};`,
            'const files = Array.from({ length: 250 }, (_, i) => i);',
            'console.log(JSON.stringify([',
            '  pageCount(250, 100),',
            '  clampPage(99, 250, 100),',
            '  pageSlice(files, 2, 100).length,',
            '  pageSlice(files, 2, 100)[0],',
            '  formatRange(2, 100, 250),',
            '  pageCount(0, 100),',
            '  formatRange(1, 100, 0),',
            ']));',
        ]);
        assert.deepEqual(JSON.parse(stdout), [3, 3, 100, 100, '101–200 of 250', 1, '0 of 0']);
    });

    test('cell observer reports viewport transitions and degrades without IO', () => {
        const stdout = runModule([
            'globalThis.window = {};',
            `const { createCellObserver, CELL_ROOT_MARGIN } = await import(${JSON.stringify(url(join(APP, 'gallery-core.js')))});`,
            'const missing = createCellObserver(() => {});',
            'globalThis.window.IntersectionObserver = class { constructor(fn, opts) { this.fn = fn; this.opts = opts; } observe() {} unobserve() {} };',
            'const seen = [];',
            'const obs = createCellObserver((target, visible) => seen.push([target, visible]));',
            'obs.fn([{ target: { id: 1 }, isIntersecting: true }, { target: { id: 2 }, isIntersecting: false }]);',
            'console.log(JSON.stringify([missing, !!obs, obs.opts.rootMargin === CELL_ROOT_MARGIN, seen]));',
        ]);
        assert.deepEqual(JSON.parse(stdout), [
            null, true, true, [[{ id: 1 }, true], [{ id: 2 }, false]],
        ]);
    });

    test('search, grouping and custom numbers stay pure', () => {
        const stdout = runModule([
            `import { clampInt, fileLabel, filterFiles, formatMetrics, groupByPack, parseSize } from ${JSON.stringify(url(join(APP, 'gallery-core.js')))};`,
            'const files = [',
            "  { id: '1', pack: 'Cats', name: '🐱', file: 'a' },",
            "  { id: '2', pack: 'Dogs', name: '🐶', file: 'b' },",
            "  { id: '3', pack: 'Cats', name: '😺', file: 'c' },",
            '];',
            "const byEmoji = filterFiles(files, '🐶').map((f) => f.id);",
            "const byPack = filterFiles(files, 'cats').map((f) => f.id);",
            "const groups = groupByPack(filterFiles(files, 'cat')).map((g) => [g.pack, g.items.length]);",
            "const labels = [fileLabel('Cats', '🐱', 0), fileLabel('Cats', '', 0), fileLabel('Cats', '', 11)];",
            "const metrics = [formatMetrics(42.4, 0.304), formatMetrics(0, 0)];",
            "console.log(JSON.stringify([byEmoji, byPack, groups, clampInt('128', 32, 320, 96), clampInt('9999', 32, 320, 96), clampInt('x', 32, 320, 96), labels, metrics, [parseSize('10', 96), parseSize('1000', 96), parseSize('x', 96), parseSize('0', 96), parseSize('1', 96)]]));",
        ]);
        assert.deepEqual(JSON.parse(stdout), [
            ['2'], ['1', '3'], [['Cats', 2]], 128, 320, 96,
            ['🐱', 'Cats 01', 'Cats 12'],
            ['load 42 ms\nrender 0.30 ms', 'load 0 ms\nrender —'],
            [10, 1000, 96, 96, 1],
        ]);
    });

    test('fps badge colours and values stay sane', () => {
        const stdout = runModule([
            `import { FPS_MAX, fpsLevel, frameRate } from ${JSON.stringify(url(join(APP, 'gallery-core.js')))};`,
            'console.log(JSON.stringify({',
            '  levels: [0, 15, 29, 30, 49, 50, 60, 120].map(fpsLevel),',
            '  rates: [frameRate(60, 1000), frameRate(3000, 1000), frameRate(0, 1000), frameRate(1, 0), FPS_MAX],',
            '}));',
        ]);
        assert.deepEqual(JSON.parse(stdout), {
            levels: ['idle', 'low', 'low', 'mid', 'mid', 'good', 'good', 'good'],
            rates: [60, 240, 0, 0, 240],
        });
    });

    test('big cells get overlay stats', () => {
        const stdout = runModule([
            `import { BIG_CELL_SIZE, isBigCell } from ${JSON.stringify(url(join(APP, 'gallery-core.js')))};`,
            'console.log(JSON.stringify({ threshold: BIG_CELL_SIZE, flags: [20, 96, 159, 160, 1000].map(isBigCell) }));',
        ]);
        assert.deepEqual(JSON.parse(stdout), {
            threshold: 160,
            flags: [false, false, false, true, true],
        });
    });

    test('stats stay readable at any emoji size', () => {
        const appText = readFileSync(APP_JS, 'utf8');
        const css = readFileSync(join(APP, 'styles.css'), 'utf8');
        assert.ok(appText.includes('isBigCell(size)'), 'large cells must be marked for the overlay');
        assert.ok(css.includes('minmax(max(var(--cell), 96px), 1fr)'), 'small cells need room for the stats');
        assert.ok(css.includes('.cell.big .metrics'), 'large cells need stats over the canvas');
    });

    test('cloud modules delegate to the generated fixture manifest', () => {
        const handler = readFileSync(HANDLER, 'utf8');
        const endpoint = readFileSync(ENDPOINT, 'utf8');
        assert.ok(handler.includes("from '../lib/fixtures.js'"));
        assert.ok(handler.includes('fixtureStats'));
        assert.ok(handler.includes('/start'));
        assert.ok(endpoint.includes("from '../lib/fixtures.js'"));
        assert.ok(endpoint.includes('fixtureStats'));
    });
});
