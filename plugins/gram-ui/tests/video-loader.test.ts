/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { VideoMessage } from '../dist/components/video-message.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountFresh(progress: number): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(VideoMessage as any, {
        m: { id: 77, media: { document: { mime_type: 'video/mp4', size: 1000 } } },
        timeStr: '12:44',
        out: false,
        status: 'read',
        documentUrls: {},
        documentProgress: { 77: progress },
    });
    render(Comp, container);
    return container;
}

async function pctText(c: HTMLElement, want: string): Promise<string> {
    const t0 = Date.now();
    let text = '';
    while (Date.now() - t0 < 2000) {
        await new Promise((r) => setTimeout(r, 50));
        const el = c.querySelector('[data-role="loading-pct"]');
        text = el ? (el.textContent || '') : '';
        if (text === want) return text;
    }
    return text;
}

describe('video loader percent', () => {
    test('ticks to target instead of jumping', async () => {
        const c = mountFresh(30);
        expect(await pctText(c, '30%')).toBe('30%');
    });

    test('animations off jumps straight to target', async () => {
        (document.documentElement as any).dataset.animations = 'off';
        try {
            const c = mountFresh(70);
            expect(await pctText(c, '70%')).toBe('70%');
        } finally {
            (document.documentElement as any).dataset.animations = 'on';
        }
    });
});
