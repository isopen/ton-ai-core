/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { EmojiText } from '../dist/components/emoji-text.js';

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

function mountFresh(): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(EmojiText as any, {
        text: 'hi ❤',
        entities: [{ _: 'messageEntityCustomEmoji', offset: 3, length: 1, document_id: 'vid1' }],
        documentUrls: {},
    });
    render(Comp, container);
    return container;
}

describe('video emoji preload', () => {
    test('video emoji mounts preloading video at inView without waiting for playing', async () => {
        window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: 'vid1', url: 'blob:video1', kind: 'video' } }));
        const c = mountFresh();
        let video: HTMLVideoElement | null = null;
        const t0 = Date.now();
        while (!video && Date.now() - t0 < 2000) {
            await new Promise((r) => setTimeout(r, 50));
            video = c.querySelector('video') as HTMLVideoElement | null;
        }
        expect(video).toBeTruthy();
        expect(video!.getAttribute('preload')).toBe('auto');
        expect(video!.getAttribute('src')).toBe('blob:video1');
    });
});
