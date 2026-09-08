/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { ButtonNotice } from '../dist/components/button-notice.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

describe('ButtonNotice row anchor', () => {
    test('renders nothing without notice', () => {
        const c = mount(h(ButtonNotice as any, { notice: null }));
        expect(c.querySelector('.tgui-btn-notice')).toBeNull();
        c.remove();
    });

    test('renders nothing without row anchor', () => {
        const c = mount(h(ButtonNotice as any, {
            notice: { messageId: 1, text: 'no-rel', version: 1 },
        }));
        expect(c.querySelector('.tgui-btn-notice')).toBeNull();
        c.remove();
    });

    test('places pill above pressed button', () => {
        const c = mount(h(ButtonNotice as any, {
            notice: { messageId: 1, text: 'above-case', version: 1, rel: { x: 150, y: 200, w: 100, h: 40 } },
        }));
        const el = c.querySelector('.tgui-btn-notice') as HTMLElement;
        expect(el).toBeTruthy();
        expect(el.style.left).toBe('150px');
        expect(el.style.top).toBe('192px');
        expect(el.style.transform).toContain('-100%');
        expect(el.parentNode).toBe(c);
        c.remove();
    });

    test('flips nothing near bubble top, always above', () => {
        const c = mount(h(ButtonNotice as any, {
            notice: { messageId: 1, text: 'below-case', version: 2, rel: { x: 150, y: 20, w: 100, h: 40 } },
        }));
        const el = c.querySelector('.tgui-btn-notice') as HTMLElement;
        expect(el).toBeTruthy();
        expect(el.style.top).toBe('12px');
        expect(el.style.transform).toContain('-100%');
        c.remove();
    });
});
