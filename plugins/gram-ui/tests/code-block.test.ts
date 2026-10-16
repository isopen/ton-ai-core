/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { h } from '@ton-ai/atom/jsx-runtime';
import { TmdView } from '../dist/components/tmd-view.js';
import { CodeBlock } from '../dist/primitives/code-block.js';

const TS = [
    'const a: number = 1;',
    'function go(): void {',
    '  console.log(a);',
    '}',
    'export default go;',
].join('\n');

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h('div', null, node);
    render(Probe, container);
    return container;
}

describe('code blocks render like Telegram Web A', () => {
    test('a fenced block becomes a CodeBlock with its language label', () => {
        const root = mount(h(TmdView as any, { text: '```ts\n' + TS + '\n```', documentUrls: {} }));
        expect(root.querySelector('.md-codeblock')).not.toBeNull();
        expect(root.textContent).toContain('TypeScript');
        expect(root.textContent).toContain('const a: number = 1;');
        expect(root.querySelector('.md-codeblock__copy')).not.toBeNull();
    });

    test('language label comes from auto-detection when the fence has none', () => {
        const root = mount(h(TmdView as any, { text: '```\n' + TS + '\n```', documentUrls: {} }));
        expect(root.textContent).toContain('TypeScript');
    });

    test('rust is detected from its own syntax', () => {
        const rs = 'fn main() {\n    let mut v: Vec<u8> = Vec::new();\n    v.push(1);\n}';
        const root = mount(h(TmdView as any, { text: '```\n' + rs + '\n```', documentUrls: {} }));
        expect(root.textContent).toContain('Rust');
    });

    test('long code is collapsed with an expand toggle', () => {
        const many = Array.from({ length: 40 }, (_, i) => 'const line' + i + ' = ' + i + ';').join('\n');
        const root = mount(h(TmdView as any, { text: '```ts\n' + many + '\n```', documentUrls: {} }));
        const block = root.querySelector('.md-codeblock') as HTMLElement;
        const toggle = root.querySelector('.md-codeblock__expand') as HTMLElement;
        expect(toggle).not.toBeNull();
        expect(block.classList.contains('is-collapsed')).toBe(true);
        expect(root.querySelector('.md-codeblock__body')).not.toBeNull();
        expect(toggle.textContent).toBe('Show all lines');

        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(block.classList.contains('is-collapsed')).toBe(false);
        expect(toggle.textContent).toBe('Collapse');

        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(block.classList.contains('is-collapsed')).toBe(true);
        expect(toggle.textContent).toBe('Show all lines');
    });

    test('short code has no collapse toggle', () => {
        const root = mount(h(TmdView as any, { text: '```ts\nconst a = 1;\n```', documentUrls: {} }));
        expect(root.querySelector('.md-codeblock__expand')).toBeNull();
        expect((root.querySelector('.md-codeblock') as HTMLElement).classList.contains('is-collapsed')).toBe(false);
    });

    test('server pre entity also becomes a CodeBlock', () => {
        const root = mount(h(TmdView as any, {
            text: TS,
            documentUrls: {},
            foreignEntities: [{ _: 'messageEntityPre', offset: 0, length: TS.length }],
        }));
        expect(root.querySelector('.md-codeblock')).not.toBeNull();
        expect(root.textContent).toContain('TypeScript');
    });

    test('inline code keeps the small chip, not the block chrome', () => {
        const root = mount(h(TmdView as any, { text: 'use `const a = 1` here', documentUrls: {} }));
        expect(root.querySelector('code.md-code')).not.toBeNull();
        expect(root.querySelector('.md-codeblock')).toBeNull();
    });

    test('CodeBlock is usable on its own outside markdown', () => {
        const root = mount(h(CodeBlock as any, { code: 'SELECT id FROM users;', lang: 'sql' }));
        expect(root.textContent).toContain('SQL');
        expect(root.querySelector('.md-codeblock__copy')).not.toBeNull();
        expect(root.querySelector('.md-codeblock__expand')).toBeNull();
    });

    test('code is rendered monochrome, like the Telegram Web A reference', () => {
        const root = mount(h(TmdView as any, { text: '```ts\nconst a: number = 1;\n```', documentUrls: {} }));
        const code = root.querySelector('.md-codeblock__pre code') as HTMLElement;
        expect(code.querySelectorAll('span')).toHaveLength(0);
        expect(code.textContent).toBe('const a: number = 1;');
    });

    test('dark theme and light theme both keep the text readable', () => {
        const root = mount(h(TmdView as any, { text: '```ts\nconst a = 1;\n```', documentUrls: {} }));
        const body = root.querySelector('.md-codeblock__body') as HTMLElement;
        expect(body).not.toBeNull();
        document.documentElement.setAttribute('data-theme', 'light');
        expect(getComputedStyle(body).color).not.toBe('');
        document.documentElement.setAttribute('data-theme', 'dark');
        expect(getComputedStyle(body).color).not.toBe('');
    });
});
