/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { VideoMessage } from '../dist/components/video-message.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const doc = {
    _: 'document',
    id: 'v1',
    mime_type: 'video/mp4',
    attributes: [{ _: 'documentAttributeVideo', w: 640, h: 360, duration: 10 }],
};
const msg = { id: 201, date: 0, media: { _: 'messageMediaDocument', document: doc }, message: '' };

describe('video fullscreen', () => {
    test('fullscreen button opens viewer video item', async () => {
        const seen: any[] = [];
        const Probe: any = () => h(VideoMessage as any, {
            m: msg,
            timeStr: '12:00',
            out: false,
            status: 'sent',
            documentUrls: { 201: 'blob:vid1' },
            onOpenViewer: (item: any) => { seen.push(item); },
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 50));
        const btn = container.querySelector('button[data-action="fullscreen"]') as HTMLButtonElement | null;
        expect(btn).not.toBeNull();
        btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBe(1);
        expect(seen[0].kind).toBe('video');
        expect(seen[0].m).toBe(msg);
        document.body.removeChild(container);
    });
});
