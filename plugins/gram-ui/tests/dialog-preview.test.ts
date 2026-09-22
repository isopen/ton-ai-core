/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { EmojiText } from '../dist/components/emoji-text.js';

if (typeof (global as any).IntersectionObserver === 'undefined') {
    (global as any).IntersectionObserver = class {
        private cb: any;
        constructor(cb: any) { this.cb = cb; }
        observe(target: any) { try { this.cb([{ isIntersecting: true, target }]); } catch {}
        }
        unobserve() {}
        disconnect() {}
    };
}

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    const flat: any[] = [];
    const push = (c: any) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) { c.forEach(push); return; }
        if (typeof c === 'string' || typeof c === 'number') {
            flat.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
        } else {
            flat.push(c);
        }
    };
    children.forEach(push);
    const p = { ...props };
    if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
    return { type, props: p, children: flat, key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => (typeof node === 'function' ? (node as any)() : node);
    render(Comp, container);
    return container;
}

describe('dialog preview cold load (post-F5, gram-db cache, no urls yet)', () => {
    test('custom entity renders blank slot, never alt text', async () => {
        const c = mount(h(EmojiText as any, {
            text: 'hi ❤',
            entities: [{ _: 'messageEntityCustomEmoji', offset: 3, length: 1, document_id: '999' }],
            documentUrls: {},
            ctx: 'dialog',
        }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('span.tgui-emoji-slot').length).toBe(1);
        expect(c.querySelector('span.tgui-emoji-slot')?.textContent).toBe('');
        expect(c.textContent).not.toContain('❤');
        document.body.removeChild(c);
    });

    test('string-typed offsets still map to slots (no alt fallback)', async () => {
        const c = mount(h(EmojiText as any, {
            text: 'hi ❤',
            entities: [{ _: 'messageEntityCustomEmoji', offset: '3' as any, length: '1' as any, document_id: '999' }],
            documentUrls: {},
            ctx: 'dialog',
        }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('span.tgui-emoji-slot').length).toBe(1);
        expect(c.textContent).not.toContain('❤');
        document.body.removeChild(c);
    });
});
