/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { h } from '@ton-ai/atom/jsx-runtime';
import { TmdView } from '../dist/components/tmd-view.js';
import { AppContext } from '../dist/app-context.js';

const TEXT = [
    'Правка в plugins/gram-ui/src/components/tmd-view.tsx затрагивает',
    'ещё и packages/core/src/crypton/utils.ts, а также .opencode/opencode.json.',
    '',
    'Внутри блока:',
    '```ts',
    'const p = "plugins/tmd/src/renderer.ts";',
    '```',
].join('\n');

let copied: string[] = [];
let dispatched: any[] = [];

async function mount(): Promise<HTMLElement> {
    (navigator as any).clipboard = { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = {
        theme: 'dark',
        imageQuality: 'max',
        animationsEnabled: false,
        selfUserId: '1',
        selectedPeer: null,
        activeSkill: null,
        pluginSkills: [],
        langCode: 'en',
        dispatch: (a: any) => { dispatched.push(a); },
    };
    const Probe: any = () =>
        h(AppContext.Provider as any, { value: ctx },
            h(TmdView as any, { text: TEXT, documentUrls: {} }));
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 60));
    return container;
}

beforeEach(() => {
    copied = [];
    dispatched = [];
});

describe('a file path in a message is copied on click', () => {
    test('paths become chips, code blocks keep their own copy button', async () => {
        const root = await mount();
        const chips = Array.from(root.querySelectorAll('.md-path'));
        expect(chips.map((c) => c.textContent)).toEqual([
            'plugins/gram-ui/src/components/tmd-view.tsx',
            'packages/core/src/crypton/utils.ts',
            '.opencode/opencode.json',
        ]);
        expect(Array.from(root.querySelectorAll('pre .md-path'))).toHaveLength(0);
        expect(root.querySelector('.md-codeblock')).not.toBeNull();
    });

    test('clicking a chip copies it and raises a toast', async () => {
        const root = await mount();
        const chip = root.querySelectorAll('.md-path')[0] as HTMLElement;
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 10));
        expect(copied).toEqual(['plugins/gram-ui/src/components/tmd-view.tsx']);
        expect(dispatched).toEqual([{ type: 'SET_ERROR', error: 'Path copied to clipboard' }]);
    });

    test('non-path text is not clickable', async () => {
        const root = await mount();
        const body = root.querySelector('.tmd-body') as HTMLElement;
        body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(copied).toHaveLength(0);
        expect(dispatched).toHaveLength(0);
    });

    test('a copy failure does not raise a toast', async () => {
        const root = await mount();
        (navigator as any).clipboard = { writeText: () => Promise.reject(new Error('denied')) };
        const chip = root.querySelectorAll('.md-path')[0] as HTMLElement;
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(dispatched).toHaveLength(0);
    });

    test('only file paths are chipped, directories and plain words are not', async () => {
        const text = [
            'Каталог plugins/gram-ui/src и модуль @ton-ai/core не чипятся,',
            'а вот packages/core/src/crypton/utils.ts и ./rust/src/lib.rs чипятся.',
        ].join('\n');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Probe: any = () => h('div', null, h(TmdView as any, { text, documentUrls: {} }));
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 60));
        const chips = Array.from(container.querySelectorAll('.md-path')).map((c) => c.textContent);
        expect(chips).toEqual(['packages/core/src/crypton/utils.ts', './rust/src/lib.rs']);
    });

    test('the chip is monospace and underlined like the reference', () => {
        const css = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'src', 'styles.css'),
            'utf8',
        ) as string;
        const block = (css.split('.md-path {')[1] || '').split('}')[0];
        expect(block).toContain('monospace');
        expect(block).toContain('text-decoration: underline');
        expect(block).toContain('cursor: pointer');
        expect(block).toContain('user-select: none');
    });
});
