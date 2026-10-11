/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '@ton-ai/gram-media';
import { reducer, defaultState } from '../dist/state.js';
import { MediaSourceBadge } from '../dist/components/media-source-badge.js';
import { EmojiDocCell, EmojiPicker } from '../dist/components/emoji-picker.js';
import { EmojiCanvas } from '../dist/components/emoji-canvas.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).URL.createObjectURL = () => 'blob:audit-' + Math.random().toString(16).slice(2);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function builtCss(): string {
  return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
}

function builtFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist', rel), 'utf8');
}

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch);
  const m = new RegExp(escaped + '\\s*\\{[^}]*\\}', 'm').exec(css);
  return m ? m[0] : '';
}

function mount(node: () => any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Host: any = () => node();
  render(Host, container);
  return container;
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe('media source indicator colour contract', () => {
  beforeAll(() => {
    setScope('gram-ui:media-source-badge', { enabled: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test.each([
    ['memory', 'tgui-media-source-badge--db', '#eab308'],
    ['persisted', 'tgui-media-source-badge--db', '#eab308'],
    ['home-server', 'tgui-media-source-badge--srv', '#ef4444'],
    ['cdn-server', 'tgui-media-source-badge--srv', '#ef4444'],
    ['migrate-server', 'tgui-media-source-badge--srv', '#ef4444'],
    ['unknown', 'tgui-media-source-badge--db', '#eab308'],
    ['glyph', 'tgui-media-source-badge--glyph', '#22c55e'],
  ])('dot for %s uses modifier %s painted %s', async (source, mod, color) => {
    const container = mount(() => h(MediaSourceBadge as any, { source, variant: 'dot' }));
    await wait(20);
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain(mod);
    expect(builtCss()).toContain('--dot: ' + color);
  });

  test.each([
    ['memory', '#eab308'],
    ['persisted', '#eab308'],
    ['home-server', '#ef4444'],
  ])('badge for %s uses the same colour as the dot (%s)', async (source, color) => {
    const container = mount(() => h(MediaSourceBadge as any, { source, variant: 'badge', absolute: false }));
    await wait(20);
    const badge = container.querySelector('.tgui-media-source-badge') as HTMLElement;
    expect(badge.getAttribute('style') || '').toContain('background:' + color);
  });

  test('exactly two dot colours exist: local yellow, network red, and green only for glyph', () => {
    const css = builtCss();
    const hue = (m: string) => {
      const found = new RegExp('\\.tgui-media-source-badge--' + m + '\\s*\\{[^}]*--dot:\\s*(#[0-9a-fA-F]{6})').exec(css);
      expect(found).not.toBeNull();
      return found![1].toLowerCase();
    };

    expect(hue('db')).toBe(hue('db'));
    expect(hue('srv')).not.toBe(hue('db'));
    expect(hue('glyph')).not.toBe(hue('srv'));

    expect(css).not.toContain('.tgui-media-source-badge--mem');
  });

  test('badge never intercepts taps', () => {
    expect(cssBlock(builtCss(), '.tgui-media-source-badge')).toContain('pointer-events: none');
  });
});

describe('dots are not suppressed in emoji and sticker surfaces', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('no blanket rule hides dots inside every button', () => {
    expect(builtCss()).not.toMatch(/^button\s+\.tgui-media-source-badge--dot\s*\{/m);
  });

  test('rich text and inline keyboard buttons scale the dot instead of hiding it', () => {
    const css = builtCss();
    const group = /\.rich-btn \.tgui-media-source-badge--dot,\s*\.rich-cell-btn \.tgui-media-source-badge--dot,\s*\.MessageBubble__kb-btn \.tgui-media-source-badge--dot\s*\{[^}]*\}/.exec(css);
    expect(group).not.toBeNull();
    expect(group![0]).not.toContain('display: none');

    expect(group![0]).toMatch(/width:\s*[\d.]+em/);
    expect(group![0]).toMatch(/height:\s*[\d.]+em/);
  });

  test('no rule hides the indicator anywhere', () => {
    const css = builtCss();
    const hidden = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /display:\s*none/.test(m[2] || '') && m[2]!.includes('tgui-media-source-badge'))
      .map((m) => m[1]!.trim());
    expect(hidden).toEqual([]);
  });

  test('picker cells establish a positioning context for the dot', () => {
    const css = builtCss();
    for (const sel of ['.picker__body .emoji-doc', '.picker__body .sticker', '.picker__body .gift']) {
      expect(cssBlock(css, sel)).toContain('position: relative');
    }
  });

  test('dot is stacked above picker cell decorations', () => {
    const block = cssBlock(builtCss(), '.picker__body .tgui-media-source-badge--dot');
    expect(block).toContain('z-index: 3');
  });

  test('emoji doc cell paints a dot when the source is known', async () => {
    const container = mount(() => h(EmojiDocCell as any, {
      docId: '777', glyph: 'X', documentUrls: { 'emojipack-777': 'blob:a' },
      documentSources: { 'emojipack-777': 'persisted' }, onPick: () => { },
    }));
    await wait();
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
  });

  test('emoji doc cell without a known source paints a neutral unknown dot', async () => {
    const container = mount(() => h(EmojiDocCell as any, {
      docId: '778', glyph: 'X', documentUrls: { 'emojipack-778': 'blob:a' }, onPick: () => { },
    }));
    await wait();
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
    expect(dot.getAttribute('title')).toBe('unknown');
  });

  test('emoji canvas paints one dot per source with the matching colour', async () => {
    const container = mount(() => h(EmojiCanvas as any, {
      segments: [
        { type: 'emoji', docId: '1', value: 'a', custom: true },
        { type: 'emoji', docId: '2', value: 'b', custom: true },
        { type: 'emoji', docId: '3', value: 'c', custom: true },
      ],
      documentUrls: { 'emojipack-1': 'blob:1', 'emojipack-2': 'blob:2', 'emojipack-3': 'blob:3' },
      documentSources: { 'emojipack-1': 'memory', 'emojipack-2': 'persisted', 'emojipack-3': 'home-server' },
    }));
    await wait();
    expect(container.querySelectorAll('.tgui-media-source-badge--dot')).toHaveLength(3);

    expect(container.querySelectorAll('.tgui-media-source-badge--db')).toHaveLength(2);
    expect(container.querySelectorAll('.tgui-media-source-badge--srv')).toHaveLength(1);
  });

  test('emoji canvas accepts a documentSources prop at all', () => {
    expect(builtFile('components/emoji-canvas.js')).toContain('documentSources');
  });
});

describe('picker indicator plumbing', () => {
  test('EmojiPicker accepts documentSources', () => {
    expect(builtFile('components/emoji-picker.js')).toContain('documentSources');
  });

  test('every picker cell renders the badge component', () => {
    const src = builtFile('components/emoji-picker.js');
    expect(src).toContain('media-source-badge.js');
    for (const cell of ['StickerCell', 'GifCell', 'GiftCell', 'PickerCellImpl', 'EmojiDocCell']) {
      expect(src).toContain(cell);
    }
    expect((src.match(/MediaSourceBadge/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(builtFile('components/emoji-canvas.js')).toContain('MediaSourceBadge');
  });

  test('chat input forwards documentSources into the picker', () => {
    const src = builtFile('components/chat-input.js');
    expect(src).toMatch(/EmojiPicker[\s\S]{0,400}documentSources/);

    expect(src).toContain('documentSources');
  });

  test('reactions picker receives sources too', () => {
    expect(builtFile('components/reactions.js')).toContain('documentSources');
    expect(builtFile('components/message-bubble.js')).toContain('documentSources');
  });

  test('picker still mounts when sources are provided', async () => {
    const container = mount(() => h(EmojiPicker as any, {
      documentUrls: { 'emojipack-1': 'blob:1' },
      documentSources: { 'emojipack-1': 'memory' },
    }));
    await wait();
    expect(container).not.toBeNull();
  });
});

describe('indicator survives url and source invalidation', () => {
  const base = () => ({ ...defaultState() } as any);

  test('clearing an emoji url drops its source with it', () => {
    let s = base();
    s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT', messageId: 'emojipack-5', url: 'blob:x', cacheSource: 'memory' } as any);
    expect(s.documentSources['emojipack-5']).toBe('memory');
    s = reducer(s, { type: 'CLEAR_EMOJI_DOCUMENTS', keys: ['emojipack-5'] } as any);

    expect(s.documentSources['emojipack-5']).toBeUndefined();
    expect(s.documentUrls['emojipack-5']).toBeUndefined();
  });

  test('a repeated dispatch with the same url still records a new source', () => {
    let s = base();
    s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT', messageId: 4, url: 'blob:a', cacheSource: 'persisted' } as any);
    s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT', messageId: 4, url: 'blob:a', cacheSource: 'memory' } as any);
    expect(s.documentSources['4']).toBe('memory');
  });

  test('a repeated dispatch with the same url and same source is a no-op', () => {
    let s = base();
    s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT', messageId: 4, url: 'blob:a', cacheSource: 'memory' } as any);
    const after = s;
    s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT', messageId: 4, url: 'blob:a', cacheSource: 'memory' } as any);
    expect(s).toBe(after);
  });
});

describe('router keeps the source for synthetic emoji keys', () => {
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  function storeHost() {
    let state: any = defaultState();
    const listeners = new Set<() => void>();
    return {
      state: () => state,
      subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
      dispatch: (action: any) => {
        const next = reducer(state, action);
        if (next === state) return;
        state = next;
        for (const cb of Array.from(listeners)) cb();
      },
    };
  }

  function transport(cacheSource: string): any {
    return {
      callRpc: async () => ({}),
      downloadFile: async () => ({ bytes: new Uint8Array(512).buffer, fileType: 'image/webp', cacheSource }),
      downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({ index, bytes: new Uint8Array(512).buffer, type: 'image/webp', cacheSource })),
      startPhotoDownload: async () => null,
      startVideoStream: async () => ({}),
      cancelPhotoDownloads: async () => { },
      batchCheckDocumentCache: async () => ({}),
    };
  }

  function makeRouter(host: any, cacheSource: string): any {
    return new GramMediaRouter({
      tgService: { current: transport(cacheSource) } as any,
      dispatch: host.dispatch,
      selectedPeerRef: { current: null },
      cleanupFns: [],
      debug: false,
    } as any);
  }

  test('emoji cache hit keeps the source recorded during the download', async () => {
    const host = storeHost();
    const router = makeRouter(host, 'persisted');
    const doc = { _: 'document', id: 4242, mime_type: 'image/webp', size: 100, file_reference: new Uint8Array([1, 2, 3]) };

    router.queueDocumentDownload(doc, 'emojipack-4242', 1, 'EmojiPack');
    await settle();
    expect(host.state().documentSources['emojipack-4242']).toBe('persisted');

    router.dispatchDocumentUrl('emojipack-4242', 'blob:cached-again');
    expect(host.state().documentSources['emojipack-4242']).toBe('persisted');
  });

  test('unknown emoji with no prior source stays undefined', () => {
    const host = storeHost();
    const router = makeRouter(host, 'memory');
    router.dispatchDocumentUrl('emojipack-77777', 'blob:x');
    expect(host.state().documentSources['emojipack-77777']).toBeUndefined();
  });
});
const EMOJI = '\u{1F600}';

describe('indicator reaches the dialog list and forum topics', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('dialog item renders peer name and preview through EmojiText with sources', () => {
    const src = builtFile('components/dialog-item.js');
    expect(src).toContain('documentSources');
    expect(src).not.toContain('documentUrls: {}');
    expect(src).not.toContain('documentUrls: {}');
    const empty = /documentUrls=\{\}/.test(src);
    expect(empty).toBe(false);
  });

  test('dialog item is fed urls and sources by the sidebar', () => {
    const src = builtFile('components/sidebar.js');
    expect(src).toMatch(/DialogItem[\s\S]{0,600}documentSources/);

    expect(src).toMatch(/a\.state\.documentSources === b\.state\.documentSources/);
    expect(src).toMatch(/a\.state\.documentUrls === b\.state\.documentUrls/);
  });

  test('forum topic titles render through EmojiText, not a bare string', () => {
    const src = builtFile('components/topics-view.js');
    expect(src).toContain('EmojiText');
    expect(src).toContain('documentSources');
    expect(src).toContain('documentUrls');

    expect(src).not.toMatch(/Text_variant_label[^>]*>\s*\{topic\.title\}\s*</);
  });

  test('topic title with a custom emoji paints a dot', async () => {
    window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: { [EMOJI]: '4242' } } }));
    const { TopicsView } = require('../dist/components/topics-view.js');
    const state: any = {
      ...defaultState(),
      selectedPeer: { type: 'supergroup', id: 9, forum: true },
      topics: [{ id: 1, title: 'build ' + EMOJI + ' done', unreadCount: 0 }],
      documentUrls: { 'emojipack-4242': 'blob:1' },
      documentSources: { 'emojipack-4242': 'persisted' },
    };
    const container = mount(() => h(TopicsView as any, { state, dispatch: () => { } }));
    await wait(80);
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
  });

  test('dialog row with a custom emoji preview paints a dot', async () => {
    window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: { [EMOJI]: '4242' } } }));
    const { DialogItem } = require('../dist/components/dialog-item.js');
    const container = mount(() => h(DialogItem as any, {
      d: {
        peer: { type: 'user', id: 5, title: 'peer ' + EMOJI },
        lastMsg: 'shipped ' + EMOJI,
        unreadCount: 0,
        date: 0,
      },
      selected: false,
      collapsed: false,
      typingText: '',
      documentUrls: { 'emojipack-4242': 'blob:1' },
      documentSources: { 'emojipack-4242': 'memory' },
      onClick: () => { },
    }));
    await wait(80);
    const dots = container.querySelectorAll('.tgui-media-source-badge--dot');
    expect(dots.length).toBeGreaterThanOrEqual(1);
    for (const d of Array.from(dots)) {
      expect((d as HTMLElement).className).toContain('tgui-media-source-badge--db');
    }
  });
});
