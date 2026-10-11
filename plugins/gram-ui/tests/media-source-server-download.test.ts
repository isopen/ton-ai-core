/**
 * @jest-environment jsdom
 */


import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { GramMediaRouter } from '@ton-ai/gram-media';
import { reducer, defaultState } from '../dist/state.js';
import { ChatArea } from '../dist/components/chat-area.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
let seq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:dl-' + (seq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const peer = { type: 'user', id: 7, accessHash: '22' };
const EMOJI = '\u{1F600}';
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

function stickerMsg(id: number, docId: number): any {
  return {
    id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
    media: { _: 'messageMediaDocument', document: { _: 'document', id: docId, mime_type: 'image/webp', size: 100, attributes: [{ _: 'documentAttributeSticker' }] } },
  };
}

function emojiMsg(id: number, docId: number): any {
  return { id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null, message: 'hey ' + EMOJI };
}

function serverTransport(cacheSource: string): any {
  return {
    callRpc: async () => ({}),
    downloadFile: async () => ({ bytes: new Uint8Array(2048).buffer, fileType: 'image/webp', cacheSource }),
    downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({ index, bytes: new Uint8Array(2048).buffer, type: 'image/webp', cacheSource })),
    startPhotoDownload: async () => null,
    startVideoStream: async () => ({}),
    cancelPhotoDownloads: async () => { },
    batchCheckDocumentCache: async () => ({}),
    batchCheckPhotoCache: async () => ({}),
  };
}

function makeHost(messages: any[]) {
  let state: any = { ...defaultState(), selectedPeer: peer, dialogs: [{ peer, unreadCount: 0, readInboxMaxId: 0 }] };
  state = reducer(state, { type: 'SET_MESSAGES', messages } as any);
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

function mount(host: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Host: any = () => {
    const [tick, setTick] = useState(0);
    useEffect(() => host.subscribe(() => setTick((v: number) => v + 1)), []);
    void tick;
    return h(ChatArea as any, { state: host.state(), dispatch: () => { }, skills: [] });
  };
  render(Host, container);
  return container;
}

function startServer(host: any, cacheSource: string): any {
  const router = new GramMediaRouter({
    tgService: { current: serverTransport(cacheSource) },
    dispatch: host.dispatch,
    selectedPeerRef: { current: null },
    cleanupFns: [],
    debug: false,
  } as any);
  router.attach();
  return router;
}

function seedEmojiMap(alt: string, docId: string): void {
  window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt, docId }] } }));
}

describe('cache cleared: server downloads paint a red circle in the chat', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('sticker and chat emoji both get a red dot after a server download', async () => {
    seedEmojiMap(EMOJI, '4242');

    const host = makeHost([stickerMsg(11, 555), emojiMsg(12, 4242)]);
    const container = mount(host);
    startServer(host, 'home-server');

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: stickerMsg(11, 555).media.document, messageId: 11, priority: 1 },
    }));
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: {
        document: {
          _: 'document', id: 4242, mime_type: 'image/webp', size: 100,
          file_reference: new Uint8Array([1, 2, 3]),
          attributes: [{ _: 'documentAttributeCustomEmoji' }],
        },
        messageId: 'emojipack-4242', priority: 1,
      },
    }));

    await settle();

    expect(host.state().documentSources['11']).toBe('home-server');
    expect(host.state().documentSources['emojipack-4242']).toBe('home-server');

    expect(container.querySelector('.tgui-sticker-preview .tgui-media-source-badge--srv')).not.toBeNull();
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--srv')).not.toBeNull();
    expect(container.querySelectorAll('.tgui-media-source-badge--srv')).toHaveLength(2);
  });

  test.each([
    ['cdn-server', '.tgui-media-source-badge--srv'],
    ['migrate-server', '.tgui-media-source-badge--srv'],
  ])('%s paints red with its own tooltip', async (source, mod) => {
    seedEmojiMap(EMOJI, '4242');

    const host = makeHost([stickerMsg(11, 555)]);
    const container = mount(host);
    startServer(host, source);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: stickerMsg(11, 555).media.document, messageId: 11, priority: 1 },
    }));
    await settle();
    expect(host.state().documentSources['11']).toBe(source);
    expect(container.querySelectorAll(mod)).toHaveLength(1);
    expect(container.querySelectorAll('.tgui-media-source-badge--dot')).toHaveLength(1);
    expect(container.querySelector('.tgui-media-source-badge--dot')!.getAttribute('title')).toBe(source);
  });

  test('a source-less dispatch logs the diagnostic and paints a neutral dot', async () => {
    seedEmojiMap(EMOJI, '4242');

    const host = makeHost([stickerMsg(11, 555)]);
    const container = mount(host);

    const router = new GramMediaRouter({
      tgService: { current: serverTransport('') },
      dispatch: host.dispatch,
      selectedPeerRef: { current: null },
      cleanupFns: [],
      debug: false,
    } as any);
    router.attach();

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: stickerMsg(11, 555).media.document, messageId: 11, priority: 1 },
    }));
    await settle();
    expect(host.state().documentSources['11']).toBeUndefined();
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
  });
});
