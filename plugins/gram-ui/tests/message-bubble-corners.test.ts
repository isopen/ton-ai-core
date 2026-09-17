/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { BubbleCornersControl } from '../dist/components/message-bubble-corners.js';
import { defaultState, reducer } from '../dist/state.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountControl(state: any): { container: HTMLElement; actions: any[] } {
  const actions: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(BubbleCornersControl as any, { state, dispatch: (a: any) => { actions.push(a); } });
  render(Probe, container);
  return { container, actions };
}

describe('message bubble corners control', () => {
  test('renders slider 0..24 with state value', async () => {
    const { container } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    const input = container.querySelector('.tgui-fontsize-row input.Slider__input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.min).toBe('0');
    expect(input.max).toBe('24');
    expect(input.step).toBe('1');
    expect(input.value).toBe('16');
    expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('16');
    document.body.removeChild(container);
  });

  test('drag updates label and live variable without dispatch', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '20';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('20');
      expect(document.documentElement.style.getPropertyValue('--message-bubble-radius')).toBe('20px');
      expect(actions.find((a) => a.type === 'SET_MESSAGE_BUBBLE_RADIUS')).toBeUndefined();
    } finally {
      document.documentElement.style.removeProperty('--message-bubble-radius');
      document.body.removeChild(container);
    }
  });

  test('release commits radius to global state', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '8';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const set = actions.find((a) => a.type === 'SET_MESSAGE_BUBBLE_RADIUS');
      expect(set).toBeTruthy();
      expect(set.radius).toBe(8);
    } finally {
      document.documentElement.style.removeProperty('--message-bubble-radius');
      document.body.removeChild(container);
    }
  });

  test('reducer defaults clamps and rounds radius', () => {
    expect(defaultState().messageBubbleRadius).toBe(16);
    const s1 = reducer(defaultState(), { type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: 20 } as any);
    expect(s1.messageBubbleRadius).toBe(20);
    const s2 = reducer(defaultState(), { type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: 99 } as any);
    expect(s2.messageBubbleRadius).toBe(24);
    const s3 = reducer(defaultState(), { type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: -5 } as any);
    expect(s3.messageBubbleRadius).toBe(0);
    const s4 = reducer(defaultState(), { type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: 15.6 } as any);
    expect(s4.messageBubbleRadius).toBe(16);
    const s5 = reducer(defaultState(), { type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: NaN } as any);
    expect(s5.messageBubbleRadius).toBe(16);
  });
});

describe('message bubble corners styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('bubble corners follow app-wide variable with fallback', () => {
    const css = builtCss();
    const baseBlock = /\.MessageBubble\s*\{[^}]*\}/.exec(css);
    expect(baseBlock).not.toBeNull();
    expect(baseBlock![0]).toContain('--bubble-r: var(--message-bubble-radius, 16px)');
    const outBlock = /\.MessageBubble_out\s*\{[^}]*\}/.exec(css);
    expect(outBlock).not.toBeNull();
    expect(outBlock![0]).toContain('var(--bubble-r)');
    const inBlock = /\.MessageBubble_in\s*\{[^}]*\}/.exec(css);
    expect(inBlock).not.toBeNull();
    expect(inBlock![0]).toContain('var(--bubble-r)');
  });

  test('grouped and tail corners derive from the same variable', () => {
    const css = builtCss();
    const baseBlock = /\.MessageBubble\s*\{[^}]*\}/.exec(css);
    expect(baseBlock).not.toBeNull();
    expect(baseBlock![0]).toContain('--bubble-r-group: max(0px, calc(var(--bubble-r) - 10px))');
    expect(baseBlock![0]).toContain('--bubble-r-tail: calc(var(--bubble-r) * 0.25)');
    const grouped = /\.MessageBubble_out\.MessageBubble_group_prev\s*\{[^}]*\}/.exec(css);
    expect(grouped).not.toBeNull();
    expect(grouped![0]).toContain('var(--bubble-r-group)');
    expect(grouped![0]).toContain('var(--bubble-r-tail)');
  });
});
