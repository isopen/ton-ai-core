/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { SettingsView } from '../dist/components/settings-view.js';
import { areChatAreaPropsEqual } from '../dist/components/chat-area.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(state: any, dispatch: (a: any) => void): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(SettingsView as any, { state, dispatch });
    render(Comp, container);
    return container;
}

const baseState = (mapProvider: string) => ({
    sessionId: 'session-123',
    dialogs: [],
    imageQuality: 'medium',
    animationsEnabled: true,
    mapProvider,
});

describe('SettingsView map provider radios', () => {
    test('three providers render with current one checked', () => {
        const seen: any[] = [];
        const c = mount(baseState('dgis'), (a: any) => seen.push(a));
        const radios = Array.from(c.querySelectorAll('input[name="map-provider"]')) as HTMLInputElement[];
        expect(radios.length).toBe(3);
        const labels = radios.map((r) => r.closest('label')?.querySelector('.Radio__label')?.textContent);
        expect(labels).toEqual(['Google Maps', 'Yandex Maps', '2GIS']);
        const checked = radios.filter((r) => r.checked).map((r) => r.value || '');
        expect(checked.length).toBe(1);
    });

    test('click dispatches SET_MAP_PROVIDER with dgis', () => {
        const seen: any[] = [];
        const c = mount(baseState('google'), (a: any) => seen.push(a));
        const labels = Array.from(c.querySelectorAll('.Radio__label')) as HTMLElement[];
        const dgis = labels.find((el) => el.textContent === '2GIS')!;
        expect(dgis).toBeTruthy();
        (dgis.closest('label') as HTMLElement).click();
        expect(seen.some((a) => a.type === 'SET_MAP_PROVIDER' && a.provider === 'dgis')).toBe(true);
    });

    test('unknown stored provider falls back to google checked', () => {
        const seen: any[] = [];
        const c = mount(baseState('qqq'), (a: any) => seen.push(a));
        const checked = Array.from(c.querySelectorAll('input[name="map-provider"]') as unknown as HTMLInputElement[]).filter((r) => (r as any).checked);
        expect(checked.length).toBe(1);
    });

    test('chat area memo tracks mapProvider so settings re-render', () => {
        const dispatch = () => {};
        const skills: any[] = [];
        const base: any = { dispatch, skills, state: { mapProvider: 'google' } };
        expect(areChatAreaPropsEqual(base, { dispatch, skills, state: { mapProvider: 'google' } })).toBe(true);
        expect(areChatAreaPropsEqual(base, { dispatch, skills, state: { mapProvider: 'dgis' } })).toBe(false);
        expect(areChatAreaPropsEqual(base, { dispatch, skills, state: { mapProvider: 'yandex' } })).toBe(false);
    });

    test('photo quality renders three radios with current one checked', () => {
        const seen: any[] = [];
        const c = mount({ ...baseState('google'), imageQuality: 'medium' }, (a: any) => seen.push(a));
        const radios = Array.from(c.querySelectorAll('input[name="photo-quality"]')) as HTMLInputElement[];
        expect(radios.length).toBe(3);
        const labels = radios.map((r) => r.closest('label')?.querySelector('.Radio__label')?.textContent);
        expect(labels).toEqual(['Low', 'Medium', 'High']);
    });

    test('photo quality click dispatches SET_IMAGE_QUALITY', () => {
        const seen: any[] = [];
        const c = mount({ ...baseState('google'), imageQuality: 'medium' }, (a: any) => seen.push(a));
        const labels = Array.from(c.querySelectorAll('.Radio__label')) as HTMLElement[];
        const high = labels.find((el) => el.textContent === 'High')!;
        expect(high).toBeTruthy();
        (high.closest('label') as HTMLElement).click();
        expect(seen.some((a) => a.type === 'SET_IMAGE_QUALITY' && a.quality === 'max')).toBe(true);
    });

    test('clear cache action lives in sessions section below its card', () => {
        const seen: any[] = [];
        const c = mount(baseState('google'), (a: any) => seen.push(a));
        const btn = c.querySelector('#tg-clear-cache-action') as HTMLElement;
        expect(btn).toBeTruthy();
        const section = btn.closest('.tgui-settings-section') as HTMLElement;
        expect(section).toBeTruthy();
        expect(section.querySelector('.tgui-settings-section-label')?.textContent).toContain('Session');
        const card = section.querySelector('.tgui-settings-card') as HTMLElement;
        expect(card).toBeTruthy();
        expect(btn.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        const logout = c.querySelector('#tg-logout-action') as HTMLElement;
        expect(logout.closest('.tgui-settings-section')).not.toBe(section);
    });
});
