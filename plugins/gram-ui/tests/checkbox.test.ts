/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { Checkbox } from '../dist/primitives/checkbox.js';

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

describe('Checkbox primitive', () => {
    test('unchecked renders empty box', () => {
        const c = mount(h(Checkbox as any, {}));
        const box = c.querySelector('.Checkbox') as HTMLElement;
        expect(box).toBeTruthy();
        expect(box.className).toContain('Checkbox_size_medium');
        expect(box.className).not.toContain('Checkbox_selected');
    });

    test('sizes map to classes', () => {
        for (const size of ['small', 'medium', 'large']) {
            const c = mount(h(Checkbox as any, { size }));
            expect(c.querySelector('.Checkbox')?.className).toContain('Checkbox_size_' + size);
            c.remove();
        }
    });

    test('checked renders selected with glyph', () => {
        const c = mount(h(Checkbox as any, { checked: true }));
        const box = c.querySelector('.Checkbox') as HTMLElement;
        expect(box.className).toContain('Checkbox_selected');
        expect(box.querySelector('svg.Checkbox__glyph')).toBeTruthy();
    });

    test('disabled renders disabled wrap and input', () => {
        const c = mount(h(Checkbox as any, { disabled: true, checked: true }));
        expect(c.querySelector('.CheckboxWrap_disabled')).toBeTruthy();
        expect(c.querySelector('.Checkbox_disabled')).toBeTruthy();
        expect((c.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });

    test('indeterminate renders dash state', () => {
        const c = mount(h(Checkbox as any, { indeterminate: true }));
        const box = c.querySelector('.Checkbox') as HTMLElement;
        expect(box.className).toContain('Checkbox_selected');
        expect(box.className).toContain('Checkbox_indeterminate');
        expect((c.querySelector('input') as HTMLInputElement).indeterminate).toBe(true);
    });

    test('label renders beside box', () => {
        const c = mount(h(Checkbox as any, { label: 'Pick me' }));
        const label = c.querySelector('.Checkbox__label') as HTMLElement;
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('Pick me');
    });

    test('click toggles and reports checked', () => {
        const seen: boolean[] = [];
        const c = mount(h(Checkbox as any, { onChange: (v: boolean) => { seen.push(v); } }));
        (c.querySelector('input') as HTMLInputElement).click();
        expect(seen).toEqual([true]);
    });
});
