/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { StaticEmojiText } from '../dist/components/emoji-canvas.js';
import { attachEmojiBurst, pickInteractionAnchor } from '../dist/components/emoji-burst.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function rect(el: Element, x: number, y: number, w: number, h: number) {
    (el as any).getBoundingClientRect = () => ({
        left: x, top: y, width: w, height: h, right: x + w, bottom: y + h,
        x, y, toJSON: () => {},
    });
}

describe('inline emoji pointer and glyph fx', () => {
    test('static emoji span carries pointer cursor and glyph mark', async () => {
        const Probe: any = () => h(StaticEmojiText as any, { value: '🥑', size: 19 });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 20));
        const span = container.querySelector('.tgui-emoji-static') as HTMLElement | null;
        expect(span).not.toBeNull();
        expect(span!.style.cursor).toBe('pointer');
        expect(span!.getAttribute('data-emoji')).toBe('🥑');
        document.body.removeChild(container);
    });

    test('tap on static emoji dispatches exact glyph', async () => {
        attachEmojiBurst();
        const seen: any[] = [];
        const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-interaction-request', onReq);
        try {
            const bubble = document.createElement('div');
            bubble.id = 'msg-7';
            bubble.className = 'MessageBubble';
            bubble.innerHTML = '<div class="tgui-emoji-canvas-wrap"><span class="tgui-emoji-static" data-emoji="🥑">🥑</span><span>hello</span></div>';
            document.body.appendChild(bubble);
            const span = bubble.querySelector('.tgui-emoji-static') as HTMLElement;
            span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
            await new Promise((r) => setTimeout(r, 20));
            expect(seen.length).toBe(1);
            expect(seen[0].messageId).toBe('7');
            expect(seen[0].glyph).toBe('🥑');
            expect(seen[0].slotIndex).toBeUndefined();
            document.body.removeChild(bubble);
        } finally {
            window.removeEventListener('tg-interaction-request', onReq);
        }
    });

    test('plain text tap inside wrap does not dispatch', async () => {
        attachEmojiBurst();
        const seen: any[] = [];
        const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-interaction-request', onReq);
        try {
            const bubble = document.createElement('div');
            bubble.id = 'msg-8';
            bubble.className = 'MessageBubble';
            bubble.innerHTML = '<div class="tgui-emoji-canvas-wrap"><span>plain hello</span></div>';
            document.body.appendChild(bubble);
            const span = bubble.querySelector('span') as HTMLElement;
            span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
            await new Promise((r) => setTimeout(r, 20));
            expect(seen.length).toBe(0);
            document.body.removeChild(bubble);
        } finally {
            window.removeEventListener('tg-interaction-request', onReq);
        }
    });

    test('anchor prefers tapped static glyph over distant slot', () => {
        const bubble = document.createElement('div');
        bubble.innerHTML = '<span class="tgui-emoji-slot" data-doc="1">X</span><span class="tgui-emoji-static" data-emoji="🥑">🥑</span>';
        document.body.appendChild(bubble);
        const win = window as any;
        const origH = win.innerHeight;
        win.innerHeight = 800;
        try {
            const [slot, glyph] = Array.from(bubble.children) as HTMLElement[];
            rect(slot, 500, 500, 20, 20);
            rect(glyph, 10, 10, 19, 19);
            const picked = pickInteractionAnchor(bubble, 15, 15);
            expect(picked).toBe(glyph);
        } finally {
            win.innerHeight = origH;
            document.body.removeChild(bubble);
        }
    });
});
