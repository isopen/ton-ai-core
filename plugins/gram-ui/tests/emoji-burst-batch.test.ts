/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { EmojiCanvas } from '../dist/components/emoji-canvas.js';

if (typeof (global as any).IntersectionObserver === 'undefined') {
    (global as any).IntersectionObserver = class {
        private cb: any;
        constructor(cb: any) { this.cb = cb; }
        observe(target: any) { try { this.cb([{ isIntersecting: true, target }]); } catch {} }
        unobserve() {}
        disconnect() {}
    };
}

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const N = 10;
const segs = Array.from({ length: N }, (_, i) => ({ type: 'emoji', docId: 'batch' + i, value: 'x', custom: true }));

describe('emoji url burst batching', () => {
    test('ten url arrivals across tasks apply in bounded renders', async () => {
        let renders = 0;
        const Probe: any = () => {
            renders++;
            return h(EmojiCanvas as any, { segments: segs, documentUrls: {} });
        };
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 80));
        renders = 0;
        for (let i = 0; i < N; i++) {
            window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: 'batch' + i, url: 'blob:u' + i, kind: 'img' } }));
            await Promise.resolve();
        }
        await new Promise((r) => setTimeout(r, 120));
        const imgs = container.querySelectorAll('img');
        expect(imgs.length).toBe(N);
        expect(renders).toBeLessThanOrEqual(6);
        document.body.removeChild(container);
    });
});
