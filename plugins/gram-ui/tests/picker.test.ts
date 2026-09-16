/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { EmojiPicker } from '../dist/components/emoji-picker.js';

jest.mock('../dist/components/animated-sticker.js', () => {
  const actual = jest.requireActual('../dist/components/animated-sticker.js') as any;
  const runtime = require('@ton-ai/atom/jsx-runtime') as any;
  return {
    ...actual,
    AnimatedSticker: (props: any) => {
      ((globalThis as any).__mockAniProps as any[]).push({ ...props });
      return runtime.h('canvas', { class: 'tgui-animated-sticker mock-ani', style: `width:${props.size}px;height:${props.size}px` });
    },
  };
});

function mountPicker(props: any = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => {
    const h = (require('@ton-ai/atom/jsx-runtime') as any).h;
    return h(EmojiPicker as any, { documentUrls: {}, onClose: () => {}, ...props });
  };
  render(Probe, container);
  return container;
}

function respondStickers(): void {
  window.addEventListener('tg-fetch-sticker-sets', () => {
    window.dispatchEvent(new CustomEvent('tg-sticker-sets-ready', {
      detail: { sets: [{ id: '1', access_hash: '11', title: 'Cats', short_name: 'cats', count: 2 }], recent: [] },
    }));
  }, { once: true });
  window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
    const d = (e as CustomEvent).detail || {};
    if (String(d.setId) !== '1') return;
    window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
      detail: { setId: String(d.setId), title: 'Cats', offset: 0, total: 2, documents: [{ id: '101', mime_type: 'image/webp' }, { id: '102', mime_type: 'image/webp' }], packs: [], hasMore: false },
    }));
  });
}

function openStickersTab(c: HTMLElement): void {
  (Array.from(c.querySelectorAll('.TguiTabs__tab')).find((el) => el.textContent === 'Stickers') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function openMyStickersChip(c: HTMLElement): void {
  (Array.from(c.querySelectorAll('.panel[data-content="stickers"] .chips .chip')).find((el) => el.textContent === 'My stickers') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('telegram picker', () => {
  test('sticker fetch error recovers via retry and renders server packs', async () => {
    let setRequests = 0;
    window.addEventListener('tg-fetch-sticker-sets', () => {
      setRequests++;
      if (setRequests === 1) {
        window.dispatchEvent(new CustomEvent('tg-sticker-sets-ready', { detail: { sets: [], recent: [], error: 'OFFLINE' } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('tg-sticker-sets-ready', {
        detail: { sets: [{ id: '1', access_hash: '11', title: 'Cats', short_name: 'cats', count: 2 }], recent: [] },
      }));
    });
    window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (String(d.setId) !== '1') return;
      window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
        detail: { setId: String(d.setId), title: 'Cats', offset: 0, total: 2, documents: [{ id: '101', mime_type: 'image/webp' }, { id: '102', mime_type: 'image/webp' }], packs: [], hasMore: false },
      }));
    });
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    openStickersTab(c);
    await new Promise((r) => setTimeout(r, 400));
    openMyStickersChip(c);
    await new Promise((r) => setTimeout(r, 60));
    expect(c.querySelectorAll('.sticker-grid .sticker').length).toBe(0);
    await new Promise((r) => setTimeout(r, 2300));
    expect(c.querySelector('.sticker-grid')).not.toBeNull();
    expect(c.querySelectorAll('.sticker-grid .sticker').length).toBeGreaterThanOrEqual(2);
    document.body.removeChild(c);
  });

  test('renders four tabs in English with search', async () => {
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    const root = c.querySelector('#picker') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.classList.contains('tgui-picker')).toBe(true);
    expect(root.classList.contains('picker')).toBe(true);
    expect(root.querySelector('.picker__header')).not.toBeNull();
    expect(root.querySelector('.picker__body')).not.toBeNull();
    expect(root.querySelector('.picker__footer')).not.toBeNull();
    expect(root.querySelector('.picker-sentinel')).not.toBeNull();
    expect(root.querySelectorAll('.picker__footer .footer-btn').length).toBe(6);
    const tabs = Array.from(c.querySelectorAll('.TguiTabs__tab')).map((el) => el.textContent);
    expect(tabs).toEqual(['Emoji', 'Stickers', 'GIF', 'Gifts']);
    const search = c.querySelector('.picker__body .search input') as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(search.placeholder).toBe('Search emoji');
    document.body.removeChild(c);
  });

  test('stickers tab fetches sets from server and renders pack grid', async () => {
    respondStickers();
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    openStickersTab(c);
    await new Promise((r) => setTimeout(r, 120));
    openMyStickersChip(c);
    await new Promise((r) => setTimeout(r, 60));
    expect(c.querySelector('.sticker-grid')).not.toBeNull();
    expect(c.querySelectorAll('.sticker-grid .sticker').length).toBeGreaterThanOrEqual(2);
    expect((c.querySelector('.picker__body .search input') as HTMLInputElement).placeholder).toBe('Search stickers');
    document.body.removeChild(c);
  });

  test('sticker pick dispatches server event and closes', async () => {
    respondStickers();
    const picked: any[] = [];
    let closed = 0;
    const onPick = (e: Event) => { picked.push((e as CustomEvent).detail); };
    window.addEventListener('tg-send-sticker', onPick);
    try {
      const c = mountPicker({ onClose: () => { closed++; } });
      await new Promise((r) => setTimeout(r, 60));
      openStickersTab(c);
      await new Promise((r) => setTimeout(r, 120));
      openMyStickersChip(c);
      await new Promise((r) => setTimeout(r, 60));
      const first = c.querySelector('.sticker-grid .sticker') as HTMLElement;
      expect(first).not.toBeNull();
      first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(picked.length).toBe(1);
      expect(String(picked[0].document.id)).toBe('101');
      expect(closed).toBe(1);
      document.body.removeChild(c);
    } finally {
      window.removeEventListener('tg-send-sticker', onPick);
    }
  });

  test('gif tab fetches saved gifs and scroll sentinel exists', async () => {
    window.addEventListener('tg-fetch-saved-gifs', () => {
      window.dispatchEvent(new CustomEvent('tg-saved-gifs-ready', {
        detail: { documents: [{ id: '201', mime_type: 'video/mp4' }, { id: '202', mime_type: 'image/gif' }] },
      }));
    }, { once: true });
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    (Array.from(c.querySelectorAll('.TguiTabs__tab')).find((el) => el.textContent === 'GIF') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(c.querySelector('.gif-grid')).not.toBeNull();
    expect(c.querySelector('.picker-sentinel')).not.toBeNull();
    document.body.removeChild(c);
  });

  test('gifts tab fetches star gifts from server', async () => {
    window.addEventListener('tg-fetch-star-gifts', () => {
      window.dispatchEvent(new CustomEvent('tg-star-gifts-ready', {
        detail: { gifts: [{ id: '301', title: 'Rocket', stars: 100 }] },
      }));
    }, { once: true });
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    (Array.from(c.querySelectorAll('.TguiTabs__tab')).find((el) => el.textContent === 'Gifts') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(c.querySelector('.gift-grid')).not.toBeNull();
    expect(c.textContent).toContain('Rocket');
    document.body.removeChild(c);
  });

  test('footer switches tabs', async () => {
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    const footers = c.querySelectorAll('.picker__footer .footer-btn');
    expect(footers.length).toBe(6);
    (footers[2] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    expect((c.querySelector('.picker__body .search input') as HTMLInputElement).placeholder).toBe('Search stickers');
    document.body.removeChild(c);
  });

  test('emoji tab loads sets like stickers with scroll and picks glyph', async () => {
    const g = global as any;
    const origIO = g.IntersectionObserver;
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
    const fire = (margin: string) => {
      for (const o of seen) {
        if (o.margin !== margin || o.targets.length === 0) continue;
        o.cb(o.targets.map((t) => ({ isIntersecting: true, target: t })));
      }
    };
    const glyphs = ['❤', '👍', '🔥', '😎', '🥳', '🤩', '😛', '🥰'];
    const setIds = [21, 22, 23, 24, 25, 26, 27, 28];
    const emojiSetsPayload = {
      sets: setIds.map((id) => ({ id: String(id), access_hash: '1' + id, title: 'Set' + id, short_name: 'set' + id, count: 2 })),
    };
    window.addEventListener('tg-fetch-emoji-sets', () => {
      window.dispatchEvent(new CustomEvent('tg-emoji-sets-ready', { detail: emojiSetsPayload }));
    });
    window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const idx = setIds.indexOf(Number(d.setId));
      if (idx < 0) return;
      const base = 40 + idx;
      window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
        detail: {
          setId: String(d.setId),
          title: 'Set' + d.setId,
          offset: 0,
          total: 2,
          documents: [1, 2].map((k) => ({
            id: String(base * 10 + k),
            mime_type: 'image/webp',
            attributes: [{ _: 'documentAttributeCustomEmoji', alt: glyphs[idx] }],
          })),
          packs: [{ emoticon: glyphs[idx], documents: [String(base * 10 + 1), String(base * 10 + 2)] }],
          hasMore: false,
        },
      }));
    });
    const input = document.createElement('div');
    input.id = 'tg-msg-input';
    document.body.appendChild(input);
    try {
      const c = mountPicker();
      await new Promise((r) => setTimeout(r, 150));
      window.dispatchEvent(new CustomEvent('tg-emoji-sets-ready', { detail: emojiSetsPayload }));
      await new Promise((r) => setTimeout(r, 150));
      const heads = () => Array.from(c.querySelectorAll('.panel[data-content="emoji"] .pack-head'));
      expect(heads().length).toBe(6);
      expect(c.querySelectorAll('.panel[data-content="emoji"] .emoji-grid .emoji-doc').length).toBe(12);
      expect(c.querySelectorAll('.panel[data-content="emoji"] .sticker-grid .sticker').length).toBe(0);
      fire('320px');
      await new Promise((r) => setTimeout(r, 120));
      expect(heads().length).toBe(7);
      expect(c.querySelector('.tgui-emoji-cell-more')).toBeNull();
      const first = c.querySelector('.panel[data-content="emoji"] .emoji-grid .emoji-doc') as HTMLElement;
      expect(first).not.toBeNull();
      const inserted: any[] = [];
      const onInsert = (e: Event) => { inserted.push((e as CustomEvent).detail); };
      window.addEventListener('tg-insert-emoji', onInsert);
      try {
        first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        expect(inserted.length).toBe(1);
        expect(inserted[0].docId).toBe('401');
        expect(inserted[0].alt).toBe('❤');
        const recentDocs = c.querySelectorAll('.panel[data-content="emoji"] .recent-row .emoji-doc');
        expect(recentDocs.length).toBeGreaterThanOrEqual(1);
        expect(c.querySelectorAll('.panel[data-content="emoji"] .recent-row .emoji-doc-glyph').length).toBe(0);
      } finally {
        window.removeEventListener('tg-insert-emoji', onInsert);
      }
      document.body.removeChild(c);
    } finally {
      if (origIO !== undefined) g.IntersectionObserver = origIO;
      else delete g.IntersectionObserver;
      if (input.parentNode) input.parentNode.removeChild(input);
    }
  });

  test('emoji search pick without doc dispatches plain text', async () => {
    const inserted: any[] = [];
    const onInsert = (e: Event) => { inserted.push((e as CustomEvent).detail); };
    window.addEventListener('tg-insert-text', onInsert);
    try {
      const c = mountPicker();
      await new Promise((r) => setTimeout(r, 80));
      window.dispatchEvent(new CustomEvent('tg-emoji-picker-ready', { detail: { categories: [], keywords: [{ keyword: 'qqq', emoticons: ['Q7'] }] } }));
      await new Promise((r) => setTimeout(r, 80));
      const search = c.querySelector('.picker__body .search input') as HTMLInputElement;
      search.value = 'qqq';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      const cell = c.querySelector('.panel[data-content="emoji"] .tgui-emoji-cell') as HTMLElement;
      expect(cell).not.toBeNull();
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(inserted.length).toBe(1);
        expect(inserted[0].text).toBe('Q7');
      document.body.removeChild(c);
    } finally {
      window.removeEventListener('tg-insert-text', onInsert);
    }
  });

  test('close button calls onClose', async () => {
    let closed = 0;
    const c = mountPicker({ onClose: () => { closed++; } });
    await new Promise((r) => setTimeout(r, 60));
    const closeBtn = c.querySelector('.picker__header .icon-btn--close') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBe(1);
    document.body.removeChild(c);
  });

  test('outside pointerdown closes, inside and toggle do not', async () => {
    let closed = 0;
    const c = mountPicker({ onClose: () => { closed++; } });
    await new Promise((r) => setTimeout(r, 60));
    const root = c.querySelector('#picker') as HTMLElement;
    expect(root).not.toBeNull();
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBe(0);
    const toggle = document.createElement('button');
    toggle.id = 'tg-emoji-btn';
    document.body.appendChild(toggle);
    try {
      toggle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(closed).toBe(0);
    } finally {
      toggle.parentNode?.removeChild(toggle);
    }
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBe(1);
    document.body.removeChild(c);
  });

  test('escape closes picker', async () => {
    let closed = 0;
    const c = mountPicker({ onClose: () => { closed++; } });
    await new Promise((r) => setTimeout(r, 60));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBeGreaterThanOrEqual(1);
    document.body.removeChild(c);
  });

  test('emoji docs render through chat canvas without alts', async () => {
    const dist = require('../dist/components/emoji-picker.js') as any;
    const mountCell = (props: any): HTMLElement => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const h = (require('@ton-ai/atom/jsx-runtime') as any).h;
      render(() => h(dist.EmojiDocCell as any, { documentUrls: {}, onPick: () => {}, ...props } as any), container);
      return container;
    };
    const c = mountCell({ docId: '601', glyph: '😎', documentUrls: { 'emojipack-601': 'https://x/601.mp4' } });
    window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: '601', url: 'https://x/601.mp4', kind: 'video' } }));
    await new Promise((r) => setTimeout(r, 60));
    expect(c.querySelector('.emoji-doc')).not.toBeNull();
    expect(c.querySelector('.emoji-doc .tgui-emoji-canvas-wrap')).not.toBeNull();
    expect(c.querySelector('.emoji-doc video')).not.toBeNull();
    expect(c.querySelector('.emoji-doc .emoji-doc-glyph')).toBeNull();
    document.body.removeChild(c);
    (globalThis as any).__mockAniProps = [];
    const c3 = mountCell({ docId: '604', glyph: '🔥', documentUrls: { 'emojipack-604': 'https://x/604.tgs' } });
    window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: '604', url: 'https://x/604.tgs', kind: 'tgs' } }));
    await new Promise((r) => setTimeout(r, 60));
    const canvas = c3.querySelector('.emoji-doc canvas.tgui-animated-sticker') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.width).toBe('40px');
    const played = ((globalThis as any).__mockAniProps as any[]).filter((p) => String(p.renderId || '').includes('emojipack-604'));
    expect(played.length).toBeGreaterThanOrEqual(1);
    expect(c3.querySelector('.emoji-doc .emoji-doc-glyph')).toBeNull();
    document.body.removeChild(c3);
    const c2 = mountCell({ docId: '602', glyph: '🥳', documentUrls: {} });
    await new Promise((r) => setTimeout(r, 60));
    expect(c2.querySelector('.emoji-doc .tgui-emoji-canvas-wrap')).not.toBeNull();
    expect(c2.querySelector('.emoji-doc .emoji-doc-glyph')).toBeNull();
    expect(c2.querySelector('.emoji-doc video')).toBeNull();
    document.body.removeChild(c2);
  });

  test('recent entries normalize legacy strings and keep doc links', async () => {
    const store = require('../dist/components/picker-store.js') as any;
    expect(store.normalizeRecentList(['❤', '👍'])).toEqual([{ g: '❤' }, { g: '👍' }]);
    expect(store.normalizeRecentList([{ g: '😎', d: '601' }, { g: 'x' }])).toEqual([{ g: '😎', d: '601' }, { g: 'x' }]);
    expect(store.normalizeRecentList([{ g: '😎', d: 602 }])).toEqual([{ g: '😎', d: '602' }]);
    expect(store.normalizeRecentList(['', null, 42, {}, { g: '' }, '🔥'])).toEqual([{ g: '🔥' }]);
    expect(store.normalizeRecentList(null)).toEqual([]);
    const loaded = await store.loadPickerRecent('tg-recent-emoji-test-key', 40);
    expect(loaded).toEqual([]);
  });

  test('popular chip shows featured sticker sets with full packs', async () => {
    window.dispatchEvent(new CustomEvent('tg-featured-sticker-sets-ready', {
      detail: { sets: [{ id: '83', access_hash: '84', title: 'Trend', short_name: 'trend', count: 3 }] },
    }));
    window.addEventListener('tg-fetch-featured-sticker-sets', () => {
      window.dispatchEvent(new CustomEvent('tg-featured-sticker-sets-ready', {
        detail: { sets: [{ id: '83', access_hash: '84', title: 'Trend', short_name: 'trend', count: 3 }] },
      }));
    });
    window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (String(d.setId) !== '83') return;
      window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
        detail: {
          setId: '83', title: 'Trend', offset: 0, total: 3,
          documents: [1, 2, 3].map((k) => ({ id: String(830 + k), mime_type: 'image/webp' })),
          packs: [], hasMore: false,
        },
      }));
    });
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 60));
    (Array.from(c.querySelectorAll('.TguiTabs__tab')).find((el) => el.textContent === 'Stickers') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const panel = c.querySelector('.panel[data-content="stickers"]') as HTMLElement;
    expect(panel.textContent).toContain('Trend');
    expect(panel.querySelectorAll('.sticker-grid .sticker').length).toBe(3);
    expect(panel.textContent).not.toContain('Mine');
    document.body.removeChild(c);
  });

  test('emoji tab appends featured sets below installed', async () => {
    window.dispatchEvent(new CustomEvent('tg-featured-emoji-sets-ready', {
      detail: { sets: [{ id: '93', access_hash: '94', title: 'Hot', short_name: 'hot', count: 1 }] },
    }));
    window.addEventListener('tg-fetch-featured-emoji-sets', () => {
      window.dispatchEvent(new CustomEvent('tg-featured-emoji-sets-ready', {
        detail: { sets: [{ id: '93', access_hash: '94', title: 'Hot', short_name: 'hot', count: 1 }] },
      }));
    });
    window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!['91', '93'].includes(String(d.setId))) return;
      const alt = String(d.setId) === '91' ? '😎' : '🔥';
      window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
        detail: {
          setId: String(d.setId), title: String(d.setId) === '91' ? 'Mine' : 'Hot', offset: 0, total: 1,
          documents: [{ id: String(d.setId) + '01', mime_type: 'image/webp', attributes: [{ _: 'documentAttributeCustomEmoji', alt }] }],
          packs: [{ emoticon: alt, documents: [String(d.setId) + '01'] }],
          hasMore: false,
        },
      }));
    });
    const c = mountPicker();
    await new Promise((r) => setTimeout(r, 200));
    const panel = c.querySelector('.panel[data-content="emoji"]') as HTMLElement;
    expect(panel.textContent).toContain('Hot');
    expect(panel.textContent).toContain('Popular');
    document.body.removeChild(c);
  });

  test('pack error does not cache empty grid and recovers on retry', async () => {
    const store = require('../dist/components/picker-store.js') as any;
    let packCalls = 0;
    window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (String(d.setId) !== '97') return;
      packCalls++;
      if (packCalls === 1) {
        window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', { detail: { setId: '97', error: 'OFFLINE' } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
        detail: {
          setId: '97', title: 'Flaky', offset: 0, total: 2,
          documents: [{ id: '971', mime_type: 'image/webp' }, { id: '972', mime_type: 'image/webp' }],
          packs: [], hasMore: false,
        },
      }));
    });
    store.ensureStickerPack('97', '98');
    await new Promise((r) => setTimeout(r, 200));
    expect((store.getStickerPack('97')?.documents || []).length).toBe(0);
    expect(store.getStickerPack('97')?.hasMore).toBe(true);
    await new Promise((r) => setTimeout(r, 1800));
    expect((store.getStickerPack('97')?.documents || []).length).toBe(2);
    expect(packCalls).toBe(2);
  });
});
