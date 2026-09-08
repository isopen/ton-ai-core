/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { Toast } from '../dist/primitives/toast.js';

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

describe('Toast primitive', () => {
    test('renders nothing without text', () => {
        const c = mount(h(Toast as any, { text: '', version: 0 }));
        expect(c.querySelector('.toast')).toBeNull();
    });

    test('renders nothing when hidden', () => {
        const c = mount(h(Toast as any, { text: 'hi', visible: false, version: 0 }));
        expect(c.querySelector('.toast')).toBeNull();
    });

    test('renders visible toast with server text', () => {
        const c = mount(h(Toast as any, { text: 'Limit reached', version: 3 }));
        const el = c.querySelector('.toast') as HTMLElement;
        expect(el).toBeTruthy();
        expect(el.className).toContain('is-visible');
        expect(el.textContent).toBe('Limit reached');
    });

    test('accepts extra class and style for anchored variants', () => {
        const c = mount(h(Toast as any, { text: 'hi', version: 1, className: 'tgui-btn-notice', style: 'left:10px' }));
        const el = c.querySelector('.toast') as HTMLElement;
        expect(el).toBeTruthy();
        expect(el.className).toContain('tgui-btn-notice');
        expect(el.style.left).toBe('10px');
    });
});
