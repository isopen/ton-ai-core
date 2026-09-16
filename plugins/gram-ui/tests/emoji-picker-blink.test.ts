/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { EmojiPicker } from '../dist/components/emoji-picker.js';

function mountPicker(props: any = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => {
    const h = (require('@ton-ai/atom/jsx-runtime') as any).h;
    return h(EmojiPicker as any, { documentUrls: { 'emojipack-9001': 'blob:blink1' }, onClose: () => {}, ...props });
  };
  render(Probe, container);
  return container;
}

function fullRect(x: number, y: number, w: number, h: number): DOMRect {
  return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => {} } as unknown as DOMRect;
}

describe('picker tgs does not blink on scroll', () => {
  test('scroll out pauses shared tgs instead of swapping to glyph', async () => {
    const g = global as any;
    const origIO = g.IntersectionObserver;
    const origRect = Element.prototype.getBoundingClientRect;
    const seen: Array<{ cb: (entries: any[]) => void; margin: string; targets: Element[] }> = [];
    g.IntersectionObserver = class {
      cb: (entries: any[]) => void;
      margin: string;
      targets: Element[];
      constructor(cb: (entries: any[]) => void, opts: any = {}) {
        this.cb = cb;
        this.margin = String(opts?.rootMargin || '0px');
        this.targets = [];
        seen.push(this as any);
      }
      observe(el: Element) { this.targets.push(el); }
      unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el); }
      disconnect() { this.targets = []; }
    };
    Element.prototype.getBoundingClientRect = function () {
      const el = this as unknown as Element;
      if ((el as HTMLElement).classList?.contains('tgui-emoji-cell')) return fullRect(10, 10, 40, 40);
      if ((el as HTMLElement).classList?.contains('tgui-emoji-grid')) return fullRect(0, 0, 320, 200);
      return origRect.call(this);
    };
    const fire = (margin: string, value: boolean, onlyCells: boolean) => {
      for (const o of seen) {
        if (o.margin !== margin || o.targets.length === 0) continue;
        const targets = onlyCells ? o.targets.filter((t) => (t as HTMLElement).classList?.contains('tgui-emoji-cell')) : o.targets;
        if (targets.length === 0) continue;
        o.cb(targets.map((t) => ({ isIntersecting: value, target: t })));
      }
    };
    try {
      const c = mountPicker();
      await new Promise((r) => setTimeout(r, 100));
      window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: { T1: '9001' } } }));
      window.dispatchEvent(new CustomEvent('tg-emoji-picker-ready', {
        detail: { categories: [], keywords: [{ keyword: 'heart', emoticons: ['T1'] }] },
      }));
      await new Promise((r) => setTimeout(r, 100));
      window.dispatchEvent(new CustomEvent('tg-emoji-url-kind', { detail: { url: 'blob:blink1', kind: 'tgs' } }));
      const search = c.querySelector('.picker__body .search input') as HTMLInputElement;
      search.value = 'heart';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      fire('110px', true, false);
      fire('0px', true, false);
      await new Promise((r) => setTimeout(r, 150));
      const cell = c.querySelector('.tgui-emoji-cell') as HTMLElement | null;
      expect(cell).not.toBeNull();
      const grid = c.querySelector('.tgui-emoji-grid') as HTMLElement | null;
      expect(grid).not.toBeNull();
      expect((c.querySelector('.tgui-emoji-shared-canvas') as HTMLElement | null)).not.toBeNull();
      const animBefore = cell!.querySelector('.tgui-emoji-shared-anim') as HTMLElement | null;
      expect(animBefore).not.toBeNull();
      expect(cell!.querySelector('.tgui-emoji-cell-glyph')).toBeNull();
      fire('0px', false, true);
      await new Promise((r) => setTimeout(r, 120));
      const animAfter = cell!.querySelector('.tgui-emoji-shared-anim') as HTMLElement | null;
      expect(animAfter).not.toBeNull();
      expect(animAfter).toBe(animBefore);
      expect(cell!.querySelector('.tgui-emoji-cell-glyph')).toBeNull();
      document.body.removeChild(c);
    } finally {
      if (origIO !== undefined) g.IntersectionObserver = origIO;
      else delete g.IntersectionObserver;
      Element.prototype.getBoundingClientRect = origRect;
    }
  });
});
