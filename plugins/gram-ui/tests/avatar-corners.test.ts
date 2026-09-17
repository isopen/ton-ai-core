/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { AvatarCornersControl } from '../dist/components/avatar-corners.js';
import { defaultState, reducer } from '../dist/state.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountControl(state: any): { container: HTMLElement; actions: any[] } {
  const actions: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(AvatarCornersControl as any, { state, dispatch: (a: any) => { actions.push(a); } });
  render(Probe, container);
  return { container, actions };
}

describe('avatar corners control', () => {
  test('renders slider 0..28 with state value', async () => {
    const { container } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    const input = container.querySelector('.tgui-fontsize-row input.Slider__input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.min).toBe('0');
    expect(input.max).toBe('28');
    expect(input.step).toBe('1');
    expect(input.value).toBe('28');
    expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('28');
    document.body.removeChild(container);
  });

  test('drag updates label and live variable without dispatch', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '8';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('8');
      expect(document.documentElement.style.getPropertyValue('--avatar-radius')).toBe('8px');
      expect(actions.find((a) => a.type === 'SET_AVATAR_RADIUS')).toBeUndefined();
    } finally {
      document.documentElement.style.removeProperty('--avatar-radius');
      document.body.removeChild(container);
    }
  });

  test('release commits radius to global state', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '0';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const set = actions.find((a) => a.type === 'SET_AVATAR_RADIUS');
      expect(set).toBeTruthy();
      expect(set.radius).toBe(0);
    } finally {
      document.documentElement.style.removeProperty('--avatar-radius');
      document.body.removeChild(container);
    }
  });

  test('reducer defaults clamps and rounds radius', () => {
    expect(defaultState().avatarRadius).toBe(28);
    const s1 = reducer(defaultState(), { type: 'SET_AVATAR_RADIUS', radius: 12 } as any);
    expect(s1.avatarRadius).toBe(12);
    const s2 = reducer(defaultState(), { type: 'SET_AVATAR_RADIUS', radius: 99 } as any);
    expect(s2.avatarRadius).toBe(28);
    const s3 = reducer(defaultState(), { type: 'SET_AVATAR_RADIUS', radius: -5 } as any);
    expect(s3.avatarRadius).toBe(0);
    const s4 = reducer(defaultState(), { type: 'SET_AVATAR_RADIUS', radius: 15.6 } as any);
    expect(s4.avatarRadius).toBe(16);
    const s5 = reducer(defaultState(), { type: 'SET_AVATAR_RADIUS', radius: NaN } as any);
    expect(s5.avatarRadius).toBe(28);
  });
});

describe('avatar corners styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('avatar radius follows app-wide variable with circle fallback', () => {
    const css = builtCss();
    const avatarBlock = /\.Avatar\s*\{[^}]*\}/.exec(css);
    expect(avatarBlock).not.toBeNull();
    expect(avatarBlock![0]).toContain('border-radius: var(--avatar-radius, 50%)');
  });
});
