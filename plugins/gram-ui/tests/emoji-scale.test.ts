/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { EmojiText, AnimatedEmoji } from '../dist/components/emoji-text.js';
import { useMessageFontSize } from '../dist/components/emoji-canvas.js';
import { InlineKeyboard } from '../dist/components/inline-keyboard.js';
import { StaticEmojiText } from '../dist/components/emoji-canvas.js';
import { messageFontPx } from '../dist/utils.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Comp: any = () => (typeof node === 'function' ? (node as any)() : node);
  render(Comp, container);
  return container;
}

describe('emoji font scaling', () => {
  test('helper preserves exact size at default', () => {
    expect(messageFontPx(14)).toBe('calc(var(--message-font-size, 14px) * 1)');
    expect(messageFontPx(19)).toBe('calc(var(--message-font-size, 14px) * 1.3571)');
    expect(messageFontPx(30)).toBe('calc(var(--message-font-size, 14px) * 2.1429)');
  });

  test('static spans use calc boxes when scaled, px otherwise', async () => {
    const c = mount(h(StaticEmojiText as any, { value: 'hi 😀', size: 19, fontScaled: true }));
    await new Promise((r) => setTimeout(r, 30));
    const span = c.querySelector('.tgui-emoji-static') as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.getAttribute('style') || '').toContain('calc(var(--message-font-size, 14px) * 1.3571)');
    expect(span.getAttribute('style') || '').toContain('vertical-align:-0.06em');
    document.body.removeChild(c);
    const c2 = mount(h(StaticEmojiText as any, { value: 'hi 😀', size: 19 }));
    await new Promise((r) => setTimeout(r, 30));
    expect((c2.querySelector('.tgui-emoji-static') as HTMLElement).getAttribute('style') || '').toContain('19px');
    expect((c2.querySelector('.tgui-emoji-static') as HTMLElement).getAttribute('style') || '').not.toContain('calc');
    document.body.removeChild(c2);
  });

  test('font scaling applies once at non-default font size', async () => {
    document.documentElement.style.setProperty('--message-font-size', '20px');
    try {
      const c = mount(h(AnimatedEmoji as any, { docId: 'd9', url: 'blob:zz', size: 20, fontScaled: true }));
      await new Promise((r) => setTimeout(r, 30));
      const wrap = c.querySelector('.tgui-emoji-scaled') as HTMLElement;
      expect(wrap).not.toBeNull();
      expect(wrap.getAttribute('style') || '').toContain('calc(var(--message-font-size, 14px) * 1.4286)');
      expect(wrap.getAttribute('style') || '').not.toContain('2.0714');
      document.body.removeChild(c);
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
    }
  });
  test('animated fallback wraps into scaled box when enabled', async () => {
    const c = mount(h(AnimatedEmoji as any, { docId: '', url: '', size: 20, fontScaled: true }));
    await new Promise((r) => setTimeout(r, 30));
    const wrap = c.querySelector('.tgui-emoji-scaled') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.getAttribute('style') || '').toContain('calc(var(--message-font-size, 14px) * 1.4286)');
    document.body.removeChild(c);
    const c2 = mount(h(AnimatedEmoji as any, { docId: '', url: '', size: 56 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(c2.querySelector('.tgui-emoji-scaled')).toBeNull();
    expect((c2.querySelector('.tgui-emoji-inline') as HTMLElement).getAttribute('style') || '').toContain('56px');
    document.body.removeChild(c2);
  });

  test('loaded inline kinds wrap into scaled box', async () => {
    const c = mount(h(AnimatedEmoji as any, { docId: 'd1', url: 'blob:fake-emoji', size: 16, fontScaled: true }));
    await new Promise((r) => setTimeout(r, 80));
    const wrap = c.querySelector('.tgui-emoji-scaled') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.getAttribute('style') || '').toContain('calc(var(--message-font-size, 14px) * 1.1429)');
    document.body.removeChild(c);
  });

  test('keyboard button emoji scale with button text', async () => {
    const rows = [[{ text: 'hi 😀', kind: 'plain' }]];
    const c = mount(h(InlineKeyboard as any, { rows, documentUrls: {} }));
    await new Promise((r) => setTimeout(r, 80));
    const html = c.innerHTML;
    expect(html.includes('calc(var(--message-font-size')).toBe(true);
    document.body.removeChild(c);
  });

  test('font hook follows commit event', async () => {
    const Probe: any = () => {
      const v = (useMessageFontSize as any)();
      return h('span', { id: 'font-probe', 'data-v': String(v) });
    };
    const c = mount(() => h(Probe as any, {}));
    await new Promise((r) => setTimeout(r, 30));
    expect(c.querySelector('#font-probe')?.getAttribute('data-v')).toBe('14');
    try {
      document.documentElement.style.setProperty('--message-font-size', '22px');
      window.dispatchEvent(new window.Event('tg-message-font-size-changed'));
      await new Promise((r) => setTimeout(r, 150));
      expect(c.querySelector('#font-probe')?.getAttribute('data-v')).toBe('22');
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
      window.dispatchEvent(new window.Event('tg-message-font-size-changed'));
      document.body.removeChild(c);
    }
  });

  test('canvas raster size follows committed font', async () => {
    const { EmojiCanvas } = await import('../dist/components/emoji-canvas.js');
    const segs = [{ type: 'emoji', docId: 'd9', value: 'x', custom: true }];
    const renderCanvas = () => h(EmojiCanvas as any, { segments: segs, documentUrls: {}, size: 19, fontScaled: true });
    const c = mount(renderCanvas);
    await new Promise((r) => setTimeout(r, 100));
    try {
      window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: 'd9', url: 'blob:img9', kind: 'img' } }));
      let img: HTMLElement | null = null;
      for (let i = 0; i < 20 && !img; i++) {
        await new Promise((r) => setTimeout(r, 50));
        img = c.querySelector('img[src="blob:img9"]') as HTMLElement | null;
      }
      expect(img).not.toBeNull();
      expect(img!.getAttribute('width')).toBe('19');
      document.documentElement.style.setProperty('--message-font-size', '30px');
      window.dispatchEvent(new window.Event('tg-message-font-size-changed'));
      await new Promise((r) => setTimeout(r, 150));
      expect((c.querySelector('img[src="blob:img9"]') as HTMLElement).getAttribute('width')).toBe('41');
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
      window.dispatchEvent(new window.Event('tg-message-font-size-changed'));
      document.body.removeChild(c);
    }
  });
});

  test('message text emoji scale by default', async () => {
    const c = mount(h(EmojiText as any, { text: 'hello 😀', entities: [], documentUrls: {} }));
    await new Promise((r) => setTimeout(r, 60));
    expect(c.innerHTML.includes('calc(var(--message-font-size')).toBe(true);
    document.body.removeChild(c);
    const c2 = mount(h(EmojiText as any, { text: 'hello 😀', entities: [], documentUrls: {}, fontScaled: false }));
    await new Promise((r) => setTimeout(r, 60));
    expect(c2.innerHTML.includes('calc(var(--message-font-size')).toBe(false);
    document.body.removeChild(c2);
  });
});

describe('emoji scale styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('scaled wrapper fills content without layout shift', () => {
    const css = builtCss();
    expect(css).toContain('.tgui-emoji-scaled');
    const fillBlock = /\.tgui-emoji-scaled > \* \{[^}]*\}/.exec(css);
    expect(fillBlock).not.toBeNull();
    expect(fillBlock![0]).toContain('width: 100% !important');
    expect(fillBlock![0]).toContain('height: 100% !important');
  });

  test('tgs canvas fills scaled slot', () => {
    const css = builtCss();
    const tgsBlock = /\.tgui-emoji-slot canvas\.tgui-animated-sticker \{[^}]*\}/.exec(css);
    expect(tgsBlock).not.toBeNull();
    expect(tgsBlock![0]).toContain('width: 100% !important');
    expect(tgsBlock![0]).toContain('height: 100% !important');
  });

  test('emoji boxes compensate baseline to line center', () => {
    const css = builtCss();
    for (const sel of ['\\.tgui-emoji-inline', '\\.tgui-emoji-placeholder', '\\.tgui-emoji-scaled']) {
      const block = new RegExp(sel + '\\s*\\{[^}]*\\}').exec(css);
      expect(block).not.toBeNull();
      expect(block![0]).toContain('vertical-align: -0.06em');
    }
  });
});
