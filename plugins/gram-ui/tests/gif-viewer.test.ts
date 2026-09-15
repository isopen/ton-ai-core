/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { GifPlayer } from '../dist/components/gif-player.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const videoDoc = {
    _: 'document',
    id: 'g1',
    mime_type: 'video/mp4',
    attributes: [{ _: 'documentAttributeAnimated' }, { _: 'documentAttributeVideo', w: 320, h: 240 }],
};
const videoMsg = { id: 101, media: { _: 'messageMediaDocument', document: videoDoc } };

const imgDoc = {
    _: 'document',
    id: 'g2',
    mime_type: 'image/gif',
    attributes: [{ _: 'documentAttributeAnimated' }],
};
const imgMsg = { id: 102, media: { _: 'messageMediaDocument', document: imgDoc } };

describe('gif fullscreen', () => {
    test('video gif click opens viewer video item', async () => {
        const seen: any[] = [];
        const Probe: any = () => h(GifPlayer as any, {
            m: videoMsg,
            documentUrls: { 101: 'blob:gif1' },
            onOpenViewer: (item: any) => { seen.push(item); },
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 30));
        const video = container.querySelector('video') as HTMLVideoElement | null;
        expect(video).not.toBeNull();
        video!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBe(1);
        expect(seen[0].kind).toBe('video');
        expect(seen[0].m).toBe(videoMsg);
        document.body.removeChild(container);
    });

    test('static gif click opens viewer photo item', async () => {
        const seen: any[] = [];
        const Probe: any = () => h(GifPlayer as any, {
            m: imgMsg,
            documentUrls: { 102: 'blob:gif2' },
            onOpenViewer: (item: any) => { seen.push(item); },
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 30));
        const img = container.querySelector('img.tgui-media-gif') as HTMLImageElement | null;
        expect(img).not.toBeNull();
        img!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBe(1);
        expect(seen[0].kind).toBe('photo');
        expect(seen[0].image.original.url).toBe('blob:gif2');
        document.body.removeChild(container);
    });

    test('no handler keeps play toggle without viewer', async () => {
        const Probe: any = () => h(GifPlayer as any, { m: videoMsg, documentUrls: { 101: 'blob:gif1' } });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 30));
        const video = container.querySelector('video') as HTMLVideoElement | null;
        expect(video).not.toBeNull();
        expect(() => video!.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
        document.body.removeChild(container);
    });
});
