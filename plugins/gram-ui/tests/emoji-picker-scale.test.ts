/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { EmojiPicker, pickerCellSize, EmojiDocCell } from '../dist/components/emoji-picker.js';
import { readMessageFontSize } from '../dist/utils.js';

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

describe('picker cell scaling', () => {
  test('cell helper maps font to cell pixels', () => {
    expect(pickerCellSize(14)).toBe(40);
    expect(pickerCellSize(22)).toBe(63);
    expect(pickerCellSize(30)).toBe(86);
    expect(pickerCellSize(undefined)).toBe(40);
    expect(pickerCellSize(NaN)).toBe(40);
  });

  test('font read follows inline variable with fallback', () => {
    expect(readMessageFontSize()).toBe(14);
    document.documentElement.style.setProperty('--message-font-size', '22px');
    expect(readMessageFontSize()).toBe(22);
    document.documentElement.style.setProperty('--message-font-size', 'junk');
    expect(readMessageFontSize()).toBe(14);
    document.documentElement.style.removeProperty('--message-font-size');
  });

  test('picker cell boxes scale with font', async () => {
    const c = mount(h(EmojiDocCell as any, { docId: 'd9', glyph: '😀', documentUrls: {} }));
    await new Promise((r) => setTimeout(r, 60));
    try {
      document.documentElement.style.setProperty('--message-font-size', '22px');
      const c2 = mount(h(EmojiDocCell as any, { docId: 'd9', glyph: '😀', documentUrls: {} }));
      await new Promise((r) => setTimeout(r, 60));
      const slot = c2.querySelector('.tgui-emoji-slot') as HTMLElement | null;
      expect(slot).not.toBeNull();
      expect(slot!.getAttribute('style') || '').toContain('calc(var(--message-font-size, 14px) * 2.8571)');
      document.body.removeChild(c2);
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
      document.body.removeChild(c);
    }
  });

  test('picker mounts without font prop', async () => {
    const c = mount(h(EmojiPicker as any, { documentUrls: {} }));
    await new Promise((r) => setTimeout(r, 60));
    expect(c.querySelector('#picker')).not.toBeNull();
    document.body.removeChild(c);
  });
});

describe('picker scale styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('cell glyphs scale with font', () => {
    const css = builtCss();
    const cellBlock = /\.tgui-emoji-cell\s*\{[^}]*\}/.exec(css);
    expect(cellBlock).not.toBeNull();
    expect(cellBlock![0]).toContain('calc(var(--message-font-size, 14px) * 1.8571)');
  });
});
