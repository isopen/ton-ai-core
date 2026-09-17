/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { StickerBubble } from '../dist/components/chat-area.js';
import { fxLayerScale } from '../dist/components/sticker-click-fx.js';
import { burstParticleSize } from '../dist/components/emoji-burst.js';

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

const TGS_DOC = { id: 'd1', mime_type: 'application/x-tgsticker' };

function mountSticker() {
  const m = { id: 7, media: { document: TGS_DOC } };
  return mount(() => h(StickerBubble as any, {
    m, timeStr: '10:29', out: true, status: 'read', documentUrls: { 7: 'blob:sticker1' },
  }));
}

describe('sticker font scaling', () => {
  test('fx helpers follow font', () => {
    expect(fxLayerScale()).toBe(1);
    expect(burstParticleSize(false)).toBe(30);
    expect(burstParticleSize(true)).toBe(56);
    try {
      document.documentElement.style.setProperty('--message-font-size', '28px');
      expect(fxLayerScale()).toBe(2);
      expect(burstParticleSize(false)).toBe(60);
      expect(burstParticleSize(true)).toBe(112);
    } finally {
      document.documentElement.style.removeProperty('--message-font-size');
    }
  });

  test('sticker preview box scales with font', async () => {
    const c = mountSticker();
    await new Promise((r) => setTimeout(r, 60));
    const preview = c.querySelector('.tgui-sticker-preview') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.getAttribute('style') || '').toContain('position');
    expect(preview.getAttribute('style') || '').not.toContain('150px');
    document.body.removeChild(c);
  });
});

describe('sticker scale styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('sticker box and fallback scale with font', () => {
    const css = builtCss();
    const previewBlock = /\.tgui-sticker-preview\s*\{[^}]*\}/.exec(css);
    expect(previewBlock).not.toBeNull();
    expect(previewBlock![0]).toContain('calc(var(--message-font-size, 14px) * 10.7143)');
    const stickerBlock = /\.tgui-sticker\s*\{[^}]*\}/.exec(css);
    expect(stickerBlock).not.toBeNull();
    expect(stickerBlock![0]).toContain('calc(var(--message-font-size, 14px) * 14.2857)');
    const emojiBlock = /\.tgui-sticker-emoji\s*\{[^}]*\}/.exec(css);
    expect(emojiBlock).not.toBeNull();
    expect(emojiBlock![0]).toContain('calc(var(--message-font-size, 14px) * 3.4286)');
  });
});
