/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { FontSizeControl } from '../dist/components/message-text-size.js';
import { SettingsView } from '../dist/components/settings-view.js';
import { defaultState, reducer } from '../dist/state.js';
import { formatFontSize } from '../dist/utils.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountControl(state: any): { container: HTMLElement; actions: any[] } {
  const actions: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(FontSizeControl as any, { state, dispatch: (a: any) => { actions.push(a); } });
  render(Probe, container);
  return { container, actions };
}

describe('message text size control', () => {
  test('renders slider 12..30 with state value', async () => {
    const { container } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    const input = container.querySelector('.tgui-fontsize-row input.Slider__input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.min).toBe('12');
    expect(input.max).toBe('30');
    expect(input.value).toBe('14');
    expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('14');
    document.body.removeChild(container);
  });

  test('drag updates label and live variable without dispatch', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '20.7';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('21');
      expect(document.documentElement.style.getPropertyValue('--message-font-size')).toBe('21px');
      expect(actions.find((a) => a.type === 'SET_MESSAGE_FONT_SIZE')).toBeUndefined();
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
      document.body.removeChild(container);
    }
  });

  test('release commits size to global state', async () => {
    const { container, actions } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = container.querySelector('input.Slider__input') as HTMLInputElement;
      input.value = '18';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const set = actions.find((a) => a.type === 'SET_MESSAGE_FONT_SIZE');
      expect(set).toBeTruthy();
      expect(set.size).toBe(18);
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
      document.body.removeChild(container);
    }
  });

  test('follows committed state without flicker', async () => {
    const { container } = mountControl({ ...defaultState(), accountWallpapers: [], documentUrls: {}, messageFontSize: 21 });
    await new Promise((r) => setTimeout(r, 30));
    expect((container.querySelector('input.Slider__input') as HTMLInputElement).value).toBe('21');
    expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('21');
    document.body.removeChild(container);
  });

  test('reducer defaults clamps and keeps size', () => {
    expect(defaultState().messageFontSize).toBe(14);
    const s1 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: 20 } as any);
    expect(s1.messageFontSize).toBe(20);
    const s2 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: 99 } as any);
    expect(s2.messageFontSize).toBe(30);
    const s3 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: 5 } as any);
    expect(s3.messageFontSize).toBe(12);
    const s4 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: NaN } as any);
    expect(s4.messageFontSize).toBe(14);
  });

  test('reducer keeps fractional sizes without rounding', () => {
    const s1 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: 15.5 } as any);
    expect(s1.messageFontSize).toBe(15.5);
    const s2 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_SIZE', size: 15.67 } as any);
    expect(s2.messageFontSize).toBe(15.67);
    expect(defaultState().messageFontFractional).toBe(false);
    const s3 = reducer(defaultState(), { type: 'SET_MESSAGE_FONT_FRACTIONAL', v: true } as any);
    expect(s3.messageFontFractional).toBe(true);
    const s4 = reducer(s3, { type: 'SET_MESSAGE_FONT_FRACTIONAL', v: true } as any);
    expect(s4.messageFontFractional).toBe(true);
  });

  test('font size formats rounded to hundredths', () => {
    expect(formatFontSize(16)).toBe('16');
    expect(formatFontSize(15.5)).toBe('15.5');
    expect(formatFontSize(15.567)).toBe('15.57');
    expect(formatFontSize(15.564)).toBe('15.56');
  });

  test('tumbler visual follows store toggle without touching slider', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Store: any = () => {
      const [st, setSt] = (useState as any)({ ...defaultState() });
      const dispatch = (a: any) => setSt(reducer(st, a));
      return h(FontSizeControl as any, { state: st, dispatch });
    };
    const Comp: any = () => h(Store as any, {});
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 50));
    const knob = () => container.querySelector('.tgui-fontsize-frac .Tumbler') as HTMLElement;
    const slider = () => container.querySelector('input.Slider__input') as HTMLInputElement;
    expect(knob().className).not.toContain('Tumbler_on');
    expect(slider().step).toBe('1');
    (container.querySelector('.tgui-fontsize-frac input') as HTMLInputElement).click();
    await new Promise((r) => setTimeout(r, 80));
    expect(knob().className).toContain('Tumbler_on');
    expect(slider().step).toBe('0.01');
    (container.querySelector('.tgui-fontsize-frac input') as HTMLInputElement).click();
    await new Promise((r) => setTimeout(r, 80));
    expect(knob().className).not.toContain('Tumbler_on');
    expect(slider().step).toBe('1');
    document.body.removeChild(container);
  });

  test('tumbler toggles fractional mode and slider step follows', async () => {
    const actions: any[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(FontSizeControl as any, {
      state: { ...defaultState(), messageFontSize: 15.567, messageFontFractional: false },
      dispatch: (a: any) => { actions.push(a); },
    });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    try {
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('16');
      expect((container.querySelector('input.Slider__input') as HTMLInputElement).step).toBe('1');
      const toggle = container.querySelector('.tgui-fontsize-frac input') as HTMLInputElement;
      expect(toggle).not.toBeNull();
      toggle.click();
      await new Promise((r) => setTimeout(r, 30));
      expect(actions).toEqual([{ type: 'SET_MESSAGE_FONT_FRACTIONAL', v: true }]);
    } finally {
      document.body.removeChild(container);
    }
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const Probe2: any = () => h(FontSizeControl as any, {
      state: { ...defaultState(), messageFontSize: 15.5, messageFontFractional: true },
      dispatch: () => {},
    });
    render(Probe2, container2);
    await new Promise((r) => setTimeout(r, 30));
    try {
      expect((container2.querySelector('input.Slider__input') as HTMLInputElement).step).toBe('0.01');
      expect(container2.querySelector('.tgui-fontsize-value')?.textContent).toBe('15.5');
    } finally {
      document.body.removeChild(container2);
    }
  });

  test('disabling fractional rounds committed size to nearest integer', async () => {
    const actions: any[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(FontSizeControl as any, {
      state: { ...defaultState(), messageFontSize: 15.567, messageFontFractional: true },
      dispatch: (a: any) => { actions.push(a); },
    });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    try {
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('15.57');
      expect((container.querySelector('input.Slider__input') as HTMLInputElement).step).toBe('0.01');
      (container.querySelector('.tgui-fontsize-frac input') as HTMLInputElement).click();
      await new Promise((r) => setTimeout(r, 30));
      expect(actions).toEqual([{ type: 'SET_MESSAGE_FONT_FRACTIONAL', v: false }]);
    } finally {
      document.body.removeChild(container);
    }
  });

  test('reducer rounds size when fractional is disabled', () => {
    const s1 = reducer(
      { ...defaultState(), messageFontSize: 15.567, messageFontFractional: true },
      { type: 'SET_MESSAGE_FONT_FRACTIONAL', v: false } as any,
    );
    expect(s1.messageFontFractional).toBe(false);
    expect(s1.messageFontSize).toBe(16);
    const s2 = reducer(
      { ...defaultState(), messageFontSize: 15.4, messageFontFractional: true },
      { type: 'SET_MESSAGE_FONT_FRACTIONAL', v: false } as any,
    );
    expect(s2.messageFontSize).toBe(15);
    const s3 = reducer(
      { ...defaultState(), messageFontSize: 15.567, messageFontFractional: false },
      { type: 'SET_MESSAGE_FONT_FRACTIONAL', v: true } as any,
    );
    expect(s3.messageFontFractional).toBe(true);
    expect(s3.messageFontSize).toBe(15.567);
  });

  test('integer mode never displays fractions, even for fractional drafts', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(FontSizeControl as any, {
      state: { ...defaultState(), messageFontSize: 15.4, messageFontFractional: false },
      dispatch: () => {},
    });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    try {
      expect(container.querySelector('.tgui-fontsize-value')?.textContent).toBe('15');
      expect((container.querySelector('input.Slider__input') as HTMLInputElement).value).toBe('15');
    } finally {
      document.body.removeChild(container);
    }
  });

  test('font collapse toggles separately from backgrounds', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fill = { _: 'wallPaperNoFile', id: '2', settings: { background_color: 0xFF112233 } };
    const Probe: any = () => h(SettingsView as any, { state: { ...defaultState(), accountWallpapers: [fill], documentUrls: {} }, dispatch: () => {} });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    (container.querySelector('.tgui-menu-item') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 60));
    const group = container.querySelector('.tgui-settings-group') as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.querySelector('.tgui-wall-grid')).toBeNull();
    expect(group.querySelector('.tgui-fontsize-row')).toBeNull();
    const headers = Array.from(group.querySelectorAll(':scope > .tgui-menu-list_bare > .tgui-menu-item')) as HTMLElement[];
    expect(headers.map((el) => el.textContent)).toEqual(['Chat background', 'Message text size', 'Corners']);
    headers[1].click();
    await new Promise((r) => setTimeout(r, 50));
    expect(group.querySelector('.tgui-fontsize-row input.Slider__input')).not.toBeNull();
    expect(group.querySelector('.tgui-wall-grid')).toBeNull();
    document.body.removeChild(container);
  });
});

describe('message text size styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('bubble text follows app-wide variable with fallback', () => {
    const css = builtCss();
    const textBlock = /\.MessageBubble__text\s*\{[^}]*\}/.exec(css);
    expect(textBlock).not.toBeNull();
    expect(textBlock![0]).toContain('var(--message-font-size, 14px)');
  });

  test('photo and media captions follow the same variable', () => {
    const css = builtCss();
    const mediaBlock = /\.MessageBubble_photo \.MessageBubble__text,\s*\.MessageBubble_media \.MessageBubble__text\s*\{[^}]*\}/.exec(css);
    expect(mediaBlock).not.toBeNull();
    expect(mediaBlock![0]).toContain('var(--message-font-size, 14px)');
    expect(mediaBlock![0]).not.toContain('font-size: 15px');
  });

  test('font size row aligns slider and value', () => {
    const css = builtCss();
    expect(css).toContain('.tgui-fontsize-row');
    expect(css).toContain('.tgui-fontsize-value');
  });

  test('slider claims horizontal touch without blocking scroll', () => {
    const css = builtCss();
    const inputBlock = /\.Slider__input\s*\{[^}]*\}/.exec(css);
    expect(inputBlock).not.toBeNull();
    expect(inputBlock![0]).toContain('touch-action: pan-y');
  });

  test('bare collapse mode keeps divider support', () => {
    const css = builtCss();
    expect(css).toContain('.tgui-menu-list_bare');
    expect(css).toContain('.tgui-menu-list_bare + .tgui-menu-list_bare');
    const groupBlock = /\.tgui-settings-group\s*\{[^}]*\}/.exec(css);
    expect(groupBlock).not.toBeNull();
    expect(groupBlock![0]).toContain('512px');
    expect(css).toContain('.tgui-settings-group > .tgui-menu-content');
  });

  test('dialog previews input polls and settings follow the same variable', () => {
    const css = builtCss();
    const descBlock = /\.Text_variant_desc\s*\{[^}]*\}/.exec(css);
    expect(descBlock).not.toBeNull();
    expect(descBlock![0]).toContain('var(--message-font-size, 14px)');
    const inputBlock = /\.ci-field__text\s*\{[^}]*\}/.exec(css);
    expect(inputBlock).not.toBeNull();
    expect(inputBlock![0]).toContain('var(--message-font-size, 15px)');
    const pollBlock = /\.tgui-poll-answer\s*\{[^}]*\}/.exec(css);
    expect(pollBlock).not.toBeNull();
    expect(pollBlock![0]).toContain('var(--message-font-size, 14px)');
    const menuBlock = /\.tgui-menu-item\s*\{[^}]*\}/.exec(css);
    expect(menuBlock).not.toBeNull();
    expect(menuBlock![0]).toContain('var(--message-font-size, 15px)');
    const labelBlock = /\.tgui-settings-label\s*\{[^}]*\}/.exec(css);
    expect(labelBlock).not.toBeNull();
    expect(labelBlock![0]).toContain('var(--message-font-size, 14px)');
    const valueBlock = /\.tgui-settings-value\s*\{[^}]*\}/.exec(css);
    expect(valueBlock).not.toBeNull();
    expect(valueBlock![0]).toContain('var(--message-font-size, 14px)');
  });

  test('every hardcoded text size is classified', () => {
    const css = builtCss();
    const fixed = ['mui-', 'Avatar', 'Badge', '.badge', 'Checkmark', 'favicon', 'gift-art',
      'sticker-emoji', 'poll-fs_close', 'poll-add-plus', 'ListItem__icon',
      'country-option-flag', 'login-country-flag', 'login-country-item-flag',
      'TguiImage__error::after', 'MediaCollage__more-overlay', 'MediaCollage__src',
      'tgui-media-source-badge', 'picker__body .emoji', 'tgui-emoji-cell',
      'tgui-emoji-tab', 'typing-indicator'];
    const re = /([^{}]+)\{([^{}]*?)font-size:\s*([\d.]+)px([^{}]*?)\}/g;
    const unclassified: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const sel = m[1].slice(-120);
      if (!fixed.some((f) => sel.includes(f))) unclassified.push(sel.trim() + ' => ' + m[3] + 'px');
    }
    expect(unclassified).toEqual([]);
  });
});
