/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { TmdView } from '../dist/components/tmd-view.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

describe('md image fullscreen', () => {
    test('click on md image opens standard viewer spec', async () => {
        const seen: any[] = [];
        const Probe: any = () => h(TmdView as any, {
            text: 'look ![pic](https://example.com/x.png) end',
            onOpenPhoto: (image: any, index: number) => { seen.push([image, index]); },
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 50));
        const img = container.querySelector('img.md-image') as HTMLImageElement | null;
        expect(img).not.toBeNull();
        img!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBe(1);
        expect(seen[0][1]).toBe(0);
        expect(seen[0][0].original.url).toBe('https://example.com/x.png');
        expect(seen[0][0].maxSizeDownloaded).toBe(true);
        document.body.removeChild(container);
    });

    test('click on plain md text does not open viewer', async () => {
        const seen: any[] = [];
        const Probe: any = () => h(TmdView as any, {
            text: 'just **bold** text',
            onOpenPhoto: (image: any, index: number) => { seen.push([image, index]); },
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(Probe, container);
        await new Promise((r) => setTimeout(r, 50));
        container.querySelector('.tmd-body')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBe(0);
        document.body.removeChild(container);
    });
});
