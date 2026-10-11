/**
 * @jest-environment jsdom
 */
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { GramMediaRouter } from '@ton-ai/gram-media';
import { ChatArea } from '../dist/components/chat-area.js';
import { reducer, defaultState } from '../dist/state.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
let urlSeq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:media-' + (urlSeq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const peer = { type: 'user', id: 7, accessHash: '22' };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function stickerMsg(id: number, docId: number): any {
  return {
    id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
    media: { _: 'messageMediaDocument', document: { _: 'document', id: docId, mime_type: 'image/webp', size: 100, attributes: [{ _: 'documentAttributeSticker' }] } },
  };
}

function emojiMsg(id: number, docId: number): any {
  return {
    id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null, message: 'hey',
    entities: [{ _: 'messageEntityCustomEmoji', document_id: docId, offset: 0, length: 3 }],
  };
}

function transportReturning(cacheSource: string): any {
  return {
    callRpc: async () => ({}),
    downloadFile: async () => ({ bytes: new Uint8Array(2048).buffer, fileType: 'image/webp', cacheSource }),
    downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({ index, bytes: new Uint8Array(2048).buffer, type: 'image/webp', cacheSource })),
    startPhotoDownload: async () => null,
    startVideoStream: async () => ({}),
    cancelPhotoDownloads: async () => { },
    batchCheckDocumentCache: async () => ({}),
  };
}

function mountStore(routerHost: { dispatch: (a: any) => void; state: () => any; subscribe: (cb: () => void) => () => void }): { container: HTMLElement; state: () => any } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Host: any = () => {
    const [tick, setTick] = useState(0);
    useEffect(() => routerHost.subscribe(() => setTick((v: number) => v + 1)), []);
    void tick;
    return h(ChatArea as any, { state: routerHost.state(), dispatch: () => { }, skills: [] });
  };
  render(Host, container);
  return { container, state: () => routerHost.state() };
}

function makeStoreHost(messages: any[]) {
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

function mountWithRouter(messages: any[], cacheSource: string): { container: HTMLElement; state: () => any } {
  const transport = transportReturning(cacheSource);
  const store = makeStoreHost(messages);
  const router = new GramMediaRouter({
    tgService: { current: transport } as any,
    dispatch: store.dispatch,
    selectedPeerRef: { current: null },
    cleanupFns: [],
    debug: false,
  } as any);
  const mounted = mountStore(store, messages);
  router.queueDocumentDownload(stickerMsg(11, 555).media.document, 11, 1, 'chat');
  router.queueDocumentDownload({ _: 'document', id: 999, mime_type: 'image/webp', size: 100, file_reference: new Uint8Array([1, 2, 3]) }, 'emojipack-999', 1, 'EmojiPack');
  return mounted;
}

describe('media source dot in the chat', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('sticker and custom emoji both get a coloured dot from the reported cache source', async () => {
    const { container, state } = mountWithRouter([stickerMsg(11, 555), emojiMsg(12, 999)], 'memory');
    await settle();
    expect(state().documentSources).toMatchObject({ 11: 'memory', 'emojipack-999': 'memory' });
    const dots = container.querySelectorAll('.tgui-media-source-badge--dot');
    expect(dots).toHaveLength(2);
    expect(container.querySelector('.tgui-sticker-preview .tgui-media-source-badge--db')).not.toBeNull();
    expect(container.querySelectorAll('.tgui-media-source-badge--srv')).toHaveLength(0);
  });

  test('a server download paints the dot red', async () => {
    const { container } = mountWithRouter([stickerMsg(11, 555)], 'home-server');
    await settle();
    expect(container.querySelectorAll('.tgui-media-source-badge--srv')).toHaveLength(1);
  });

  test('no source in the store means a neutral unknown dot, not silence', async () => {
    const store = makeStoreHost([stickerMsg(11, 555)]);
    const { container } = mountStore(store, [stickerMsg(11, 555)]);
    await settle(200);
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
  });
});
