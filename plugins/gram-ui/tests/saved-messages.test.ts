/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { MessageItem, effectiveOut } from '../dist/components/chat-area.js';
import { getPeerName } from '../dist/utils.js';
import { t, S } from '@ton-ai/gram-lang';

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
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

const baseMsg = (over: any = {}) => ({
    id: 9001, date: 1788697000, out: false, sender: 'U',
    message: 'hello', entities: [], media: null, ...over,
});

const itemProps = (m: any, extra: any = {}) => ({
    m, sameSenderPrev: false, sameSenderNext: false, isGroup: false,
    emojiUrls: {}, documentSources: {}, ...extra,
});

describe('saved messages (self peer)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    test('effectiveOut forces right side for self peer', () => {
        expect(effectiveOut({ out: false }, true)).toBe(true);
        expect(effectiveOut({ out: true }, true)).toBe(true);
        expect(effectiveOut({ out: false }, false)).toBe(false);
        expect(effectiveOut({ out: true }, false)).toBe(true);
        expect(effectiveOut({ out: false }, undefined)).toBe(false);
    });

    test('forwarded message in saved chat renders on the right', async () => {
        const m = baseMsg({ out: false });
        const c = mount(h(MessageItem as any, itemProps(m, { selfPeer: true })));
        await new Promise((r) => setTimeout(r, 20));
        const row = c.querySelector('.tgui-msg-row') as HTMLElement;
        expect(row).not.toBeNull();
        expect(row.className).toContain('tgui-msg-row-out');
        expect(row.className).not.toContain('tgui-msg-row-in');
    });

    test('foreign incoming message still renders on the left', async () => {
        const m = baseMsg({ out: false });
        const c = mount(h(MessageItem as any, itemProps(m, { selfPeer: false })));
        await new Promise((r) => setTimeout(r, 20));
        const row = c.querySelector('.tgui-msg-row') as HTMLElement;
        expect(row.className).toContain('tgui-msg-row-in');
    });

    test('own outgoing message renders on the right without selfPeer', async () => {
        const m = baseMsg({ out: true });
        const c = mount(h(MessageItem as any, itemProps(m, {})));
        await new Promise((r) => setTimeout(r, 20));
        const row = c.querySelector('.tgui-msg-row') as HTMLElement;
        expect(row.className).toContain('tgui-msg-row-out');
    });

    test('self dialog resolves to saved-messages label once id is known', () => {
        const peer = { type: 'user', id: '123', firstName: 'John', lastName: '', username: 'john' };
        expect(getPeerName(peer, '123')).toBe(t(S.SAVED_MESSAGES_PEER));
        expect(getPeerName(peer, '')).toBe('John');
        expect(getPeerName(peer, undefined)).toBe('John');
    });
});
