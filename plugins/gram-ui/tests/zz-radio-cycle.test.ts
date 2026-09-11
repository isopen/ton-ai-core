/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { SettingsView } from '../dist/components/settings-view.js';
import { reducer, defaultState } from '../dist/state.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

test('full cycle: click dgis -> reducer -> rerender -> dot moves', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let state: any = { ...defaultState(), sessionId: 's', dialogs: [], mapProvider: 'google' };
    const dispatch = (a: any) => {
        state = reducer(state, a);
        render(Comp, container);
    };
    const Comp: any = () => h(SettingsView as any, { state, dispatch });
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 50));
    const sel = () => Array.from(container.querySelectorAll('.Radio_selected')).map((el) => (el.closest('label')?.textContent || '').trim());
    // eslint-disable-next-line no-console
    console.log('BEFORE:', JSON.stringify(sel()));
    const labels = Array.from(container.querySelectorAll('.Radio__label')) as HTMLElement[];
    const dgis = labels.find((el) => el.textContent === '2GIS')!;
    (dgis.closest('label') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 100));
    console.log('AFTER:', JSON.stringify(sel()), 'state=', state.mapProvider);
});
