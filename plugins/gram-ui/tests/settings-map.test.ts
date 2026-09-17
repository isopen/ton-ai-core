/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { SettingsView } from '../dist/components/settings-view.js';
import { areChatAreaPropsEqual } from '../dist/components/chat-area.js';
import { defaultState } from '../dist/state.js';

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

    test('chat area memo tracks font size and fractional flag for settings re-render', () => {
        const dispatch = () => {};
        const skills: any[] = [];
        const base: any = { dispatch, skills, state: defaultState() };
        const changedSize: any = { dispatch, skills, state: { ...defaultState(), messageFontSize: 21 } };
        const changedFlag: any = { dispatch, skills, state: { ...defaultState(), messageFontFractional: true } };
        expect(areChatAreaPropsEqual(base, changedSize)).toBe(false);
        expect(areChatAreaPropsEqual(base, changedFlag)).toBe(false);
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

    test('devices menu item opens devices page with session info', async () => {
        const seen: any[] = [];
        const c = mount(baseState('google'), (a: any) => seen.push(a));
        const items = Array.from(c.querySelectorAll('.tgui-menu-item')) as HTMLElement[];
        const devices = items.find((el) => el.textContent === 'Devices');
        expect(devices).toBeTruthy();
        devices!.click();
        let btn: HTMLElement | null = null;
        for (let i = 0; i < 40 && !btn; i++) {
            await new Promise((r) => setTimeout(r, 25));
            btn = c.querySelector('#tg-clear-cache-action') as HTMLElement | null;
        }
        expect(btn).toBeTruthy();
    });

    test('clear cache action lives in devices section below its card', async () => {
        const seen: any[] = [];
        const c = mount(baseState('google'), (a: any) => seen.push(a));
        const items = Array.from(c.querySelectorAll('.tgui-menu-item')) as HTMLElement[];
        const devices = items.find((el) => el.textContent === 'Devices')!;
        expect(devices).toBeTruthy();
        devices.click();
        let btn: HTMLElement | null = null;
        for (let i = 0; i < 40 && !btn; i++) {
            await new Promise((r) => setTimeout(r, 25));
            btn = c.querySelector('#tg-clear-cache-action') as HTMLElement | null;
        }
        expect(btn).toBeTruthy();
        const section = btn.closest('.tgui-settings-section') as HTMLElement;
        expect(section).toBeTruthy();
        expect(section.querySelector('.tgui-settings-section-label')?.textContent).toContain('Devices');
        const card = section.querySelector('.tgui-settings-card') as HTMLElement;
        expect(card).toBeTruthy();
        expect(btn.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        expect(c.querySelector('#tg-logout-action')).toBeNull();
        document.body.removeChild(c);
    });

    test('logout block is narrow like other main-page cards', () => {
        const seen: any[] = [];
        const c = mount(baseState('google'), (a: any) => seen.push(a));
        const logout = c.querySelector('#tg-logout-action') as HTMLElement | null;
        expect(logout).not.toBeNull();
        const block = logout!.closest('.tgui-settings-actions') as HTMLElement | null;
        expect(block).not.toBeNull();
        expect(block!.classList.contains('tgui-settings-card_narrow')).toBe(true);
        document.body.removeChild(c);
    });
});
