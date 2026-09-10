/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { MediaViewer } from '../dist/components/media-viewer.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: [], key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

const photoItem = {
    kind: 'photo',
    m: null,
    image: {
        id: 'v1', width: 800, height: 600,
        thumbnail: { url: '' },
        medium: { url: 'https://x/m.jpg' },
        original: { url: 'https://x/o.jpg' },
    },
};

describe('MediaViewer fullscreen exits', () => {
    test('no close button, backdrop click closes, content click keeps open', async () => {
        const seen: string[] = [];
        const c = mount(h(MediaViewer as any, { items: [photoItem], index: 0, onClose: () => { seen.push('close'); } }));
        await new Promise((r) => setTimeout(r, 30));
        expect(c.querySelector('.MediaViewer__close')).toBeNull();
        expect(c.querySelector('.MediaViewer__backdrop')).toBeTruthy();
        (c.querySelector('.MediaViewer__container') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 30));
        expect(seen).toEqual([]);
        (c.querySelector('.MediaViewer__backdrop') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 30));
        expect(seen).toEqual(['close']);
    });

    test('escape closes', async () => {
        const seen: string[] = [];
        mount(h(MediaViewer as any, { items: [photoItem], index: 0, onClose: () => { seen.push('close'); } }));
        await new Promise((r) => setTimeout(r, 30));
        window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        expect(seen).toEqual(['close']);
    });
});
