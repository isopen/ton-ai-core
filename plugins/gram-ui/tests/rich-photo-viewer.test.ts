/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { RichMessageView } from '../dist/components/rich-message.js';

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

const photo = { id: 'rp1', sizes: [{ _: 'photoSize', type: 'y', w: 800, h: 600, url: 'blob:rich1' }] };
const richMessage = { blocks: [{ _: 'pageBlockPhoto', photo_id: 'rp1', photo }], photos: [photo] };

describe('rich photo viewer threading', () => {
    test('renders photo row with and without onOpenPhoto, no legacy overlay', async () => {
        for (const withHandler of [false, true]) {
            const seen: any[] = [];
            const props: any = { richMessage, messageId: 'm1' };
            if (withHandler) props.onOpenPhoto = (image: any, index: number) => { seen.push([image, index]); };
            const Probe: any = () => h(RichMessageView as any, props);
            const container = document.createElement('div');
            document.body.appendChild(container);
            render(Probe, container);
            await new Promise((r) => setTimeout(r, 60));
            expect(container.querySelector('.rich-photo')).not.toBeNull();
            expect(container.querySelector('.rich-photo-viewer')).toBeNull();
            expect(seen.length).toBe(0);
            document.body.removeChild(container);
        }
    });
});
