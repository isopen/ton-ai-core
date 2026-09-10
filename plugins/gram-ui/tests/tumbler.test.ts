/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { Tumbler } from '../dist/primitives/tumbler.js';

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

describe('Tumbler primitive', () => {
    test('unchecked renders track with knob', () => {
        const c = mount(h(Tumbler as any, {}));
        const box = c.querySelector('.Tumbler') as HTMLElement;
        expect(box).toBeTruthy();
        expect(box.className).toContain('Tumbler_size_medium');
        expect(box.className).not.toContain('Tumbler_on');
        expect(box.querySelector('.Tumbler__knob')).toBeTruthy();
    });

    test('sizes map to classes', () => {
        for (const size of ['small', 'medium', 'large']) {
            const c = mount(h(Tumbler as any, { size }));
            expect(c.querySelector('.Tumbler')?.className).toContain('Tumbler_size_' + size);
            c.remove();
        }
    });

    test('checked renders on state', () => {
        const c = mount(h(Tumbler as any, { checked: true }));
        expect((c.querySelector('.Tumbler') as HTMLElement).className).toContain('Tumbler_on');
    });

    test('disabled renders disabled wrap and input', () => {
        const c = mount(h(Tumbler as any, { disabled: true, checked: true }));
        expect(c.querySelector('.TumblerWrap_disabled')).toBeTruthy();
        expect(c.querySelector('.Tumbler_disabled')).toBeTruthy();
        expect((c.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });

    test('label renders beside track', () => {
        const c = mount(h(Tumbler as any, { label: 'Enable me' }));
        const label = c.querySelector('.Tumbler__label') as HTMLElement;
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('Enable me');
    });

    test('click toggles and reports checked', () => {
        const seen: boolean[] = [];
        const c = mount(h(Tumbler as any, { onChange: (v: boolean) => { seen.push(v); } }));
        (c.querySelector('input') as HTMLInputElement).click();
        expect(seen).toEqual([true]);
    });
});
