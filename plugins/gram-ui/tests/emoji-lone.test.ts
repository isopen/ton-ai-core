/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { EmojiText } from '../dist/components/emoji-text.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountText(text: string): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(EmojiText as any, { text, entities: [], documentUrls: {} });
    render(Probe, container);
    return container;
}

describe('lone emoji never shows alt text', () => {
    test('pending map renders sized placeholder instead of glyph', async () => {
        const batches: any[] = [];
        const onBatch = (e: Event) => { batches.push((e as CustomEvent).detail); };
        window.addEventListener('tg-download-emoji-batch', onBatch);
        try {
            const c = mountText('❤');
            await new Promise((r) => setTimeout(r, 60));
            expect(c.querySelector('.tgui-emoji-pending')).not.toBeNull();
            expect(c.querySelector('.tgui-emoji-static')).toBeNull();
            expect(c.textContent).toBe('');
            expect(batches.length).toBeGreaterThanOrEqual(1);
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-download-emoji-batch', onBatch);
        }
    });

    test('resolved map renders media slot, never alt text', async () => {
        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: { '❤': '1001' } } }));
        const c = mountText('❤');
        await new Promise((r) => setTimeout(r, 450));
        expect(c.querySelector('.tgui-emoji-pending')).toBeNull();
        expect(c.querySelector('[data-doc="1001"]')).not.toBeNull();
        expect(c.querySelector('.tgui-emoji-static')).toBeNull();
        expect(c.textContent).toBe('');
        window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: '1001', url: 'blob:lone1', kind: 'img' } }));
        await new Promise((r) => setTimeout(r, 80));
        const img = c.querySelector('img[src="blob:lone1"]') as HTMLElement | null;
        expect(img).not.toBeNull();
        expect(c.textContent).toBe('');
        document.body.removeChild(c);
    });

    test('genuinely plain emoji still renders glyph', async () => {
        const c = mountText('🦄');
        await new Promise((r) => setTimeout(r, 450));
        const span = c.querySelector('.tgui-emoji-static') as HTMLElement | null;
        expect(span).not.toBeNull();
        expect(span!.getAttribute('data-emoji')).toBe('🦄');
        expect(c.querySelector('.tgui-emoji-pending')).toBeNull();
        document.body.removeChild(c);
    });
});
