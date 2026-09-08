/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { Radio } from '../dist/primitives/radio.js';

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

describe('Radio primitive', () => {
    test('unchecked renders empty circle', () => {
        const c = mount(h(Radio as any, {}));
        const box = c.querySelector('.Radio') as HTMLElement;
        expect(box).toBeTruthy();
        expect(box.className).toContain('Radio_size_medium');
        expect(box.className).not.toContain('Radio_selected');
    });

    test('sizes map to classes', () => {
        for (const size of ['small', 'medium', 'large']) {
            const c = mount(h(Radio as any, { size }));
            expect(c.querySelector('.Radio')?.className).toContain('Radio_size_' + size);
            c.remove();
        }
    });

    test('checked renders selected with dot', () => {
        const c = mount(h(Radio as any, { checked: true }));
        const box = c.querySelector('.Radio') as HTMLElement;
        expect(box.className).toContain('Radio_selected');
        expect(box.querySelector('span.Radio__dot')).toBeTruthy();
        expect((c.querySelector('input') as HTMLInputElement).checked).toBe(true);
    });

    test('disabled renders disabled wrap and input', () => {
        const c = mount(h(Radio as any, { disabled: true, checked: true }));
        expect(c.querySelector('.RadioWrap_disabled')).toBeTruthy();
        expect(c.querySelector('.Radio_disabled')).toBeTruthy();
        expect((c.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });

    test('label and description render', () => {
        const c = mount(h(Radio as any, { label: 'Auto', description: 'Details here' }));
        expect((c.querySelector('.Radio__label') as HTMLElement).textContent).toBe('Auto');
        expect((c.querySelector('.Radio__description') as HTMLElement).textContent).toBe('Details here');
    });

    test('grouped by native name', () => {
        const c = mount(h(Radio as any, { name: 'quality', value: 'high' }));
        const input = c.querySelector('input') as HTMLInputElement;
        expect(input.type).toBe('radio');
        expect(input.name).toBe('quality');
        expect(input.value).toBe('high');
    });

    test('click reports checked', () => {
        const seen: boolean[] = [];
        const c = mount(h(Radio as any, { onChange: (v: boolean) => { seen.push(v); } }));
        (c.querySelector('input') as HTMLInputElement).click();
        expect(seen).toEqual([true]);
    });
});
