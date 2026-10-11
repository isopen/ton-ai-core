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
(globalThis as any).URL.createObjectURL = () => 'blob:live-' + (seq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const peer = { type: 'user', id: 7, accessHash: '22' };
const EMOJI = '\u{1F600}';
const DOC_ID = 4242;
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function stickerMsg(id: number, docId: number): any {
  return {
    id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
    media: { _: 'messageMediaDocument', document: { _: 'document', id: docId, mime_type: 'image/webp', size: 100, attributes: [{ _: 'documentAttributeSticker' }] } },
  };
}

function emojiMsg(id: number, alt: string): any {
  return { id, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null, message: 'hey ' + alt };
}

function emojiDoc(id: number): any {
  return {
    _: 'document', id, mime_type: 'image/webp', size: 100,
    file_reference: new Uint8Array([1, 2, 3]),
    attributes: [{ _: 'documentAttributeCustomEmoji', alt: EMOJI }],
  };
}

function cachedTransport(cached: Record<string, string>, onServerDownload: () => void, holdBytes = false) {
  const inCache = (id: unknown) => !!cached[String(id)];

  let release: () => void = () => { };
  const held = holdBytes ? new Promise<void>((res) => { release = res; }) : Promise.resolve();
  const answer = (id: unknown) => {
    if (!inCache(id)) onServerDownload();
    return {
      bytes: new Uint8Array(1024).buffer,
      type: 'image/webp',
      cacheSource: inCache(id) ? cached[String(id)] : 'home-server',
    };
  };
  return {
    release: () => release(),
    callRpc: async () => [emojiDoc(DOC_ID)],
    downloadFile: async (info: any) => {
      await held;
      const out = answer(info?.document?.id);
      return { bytes: out.bytes, fileType: out.type, cacheSource: out.cacheSource };
    },
    downloadFiles: async (docs: any[]) => {
      await held;
      return docs.map((d: any, index: number) => ({ index, ...answer(d?.document?.id) }));
    },
    startPhotoDownload: async () => null,
    startVideoStream: async () => ({}),
    cancelPhotoDownloads: async () => { },
    batchCheckDocumentCache: async (documents: Array<{ id: string }>) => {
      const out: Record<string, string> = {};
      for (const d of documents) if (inCache(d.id)) out[String(d.id)] = cached[String(d.id)];
      return out;
    },
    batchCheckPhotoCache: async () => ({}),
  };
}

function makeHost(messages: any[]) {
  let state: any = { ...defaultState(), selectedPeer: peer, dialogs: [{ peer, unreadCount: 0, readInboxMaxId: 0 }] };
  state = reducer(state, { type: 'SET_MESSAGES', messages } as any);
  const listeners = new Set<() => void>();
  const host = {
    state: () => state,
    setMessages: (messages: any[]) => host.dispatch({ type: 'SET_MESSAGES', messages }),
    subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    dispatch: (action: any) => {
      const next = reducer(state, action);
      if (next === state) return;
      state = next;
      for (const cb of Array.from(listeners)) cb();
    },
  };
  return host;
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

function startRouter(host: any, transport: any): GramMediaRouter {
  const router = new GramMediaRouter({
    tgService: { current: transport },
    dispatch: host.dispatch,
    selectedPeerRef: { current: null },
    cleanupFns: [],
    debug: false,
  } as any);
  router.attach();
  return router;
}

function dots(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('.tgui-media-source-badge--dot')) as HTMLElement[];
}

describe('a new message paints the cache source it already has', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('an incoming message shows the real source while its bytes are still in flight', async () => {
    let serverDownloads = 0;

    const transport = cachedTransport({ '555': 'persisted', [String(DOC_ID)]: 'memory' }, () => { serverDownloads++; }, true);

    const host = makeHost([]);
    const container = mount(host);
    const router = startRouter(host, transport);
    await settle();
    expect(dots(container)).toHaveLength(0);

    host.setMessages([stickerMsg(11, 555), emojiMsg(12, EMOJI)]);
    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt: EMOJI, docId: String(DOC_ID) }] } }));
    window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [String(DOC_ID)] } }));
    await router.injectCachedDocumentSources(host.state().messages as any);
    await settle();

    expect(host.state().documentSources['11']).toBe('persisted');
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBe('memory');
    expect(container.querySelector('.tgui-sticker-preview .tgui-media-source-badge--db')).not.toBeNull();
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--db')).not.toBeNull();
    expect(container.querySelectorAll('.tgui-media-source-badge--dot')).toHaveLength(2);
    expect(serverDownloads).toBe(0);

    transport.release();
    await settle();
  });

  test('the second message reusing the same cached sticker needs no download at all', async () => {
    let serverDownloads = 0;
    const transport = cachedTransport({ '555': 'persisted' }, () => { serverDownloads++; });

    const host = makeHost([stickerMsg(11, 555)]);
    const container = mount(host);
    const router = startRouter(host, transport);

    await router.injectCachedDocumentSources(host.state().messages as any);
    await settle();
    expect(host.state().documentSources['11']).toBe('persisted');

    const before = serverDownloads;
    host.setMessages([stickerMsg(11, 555), stickerMsg(13, 555)]);
    await router.injectCachedDocumentSources(host.state().messages as any);
    await settle();

    expect(host.state().documentSources['13']).toBe('persisted');
    expect(serverDownloads).toBe(before);
    expect(container.querySelectorAll('.tgui-sticker-preview .tgui-media-source-badge--dot')).toHaveLength(2);
  });

  test('an emoji evicted by scrolling comes back with its real source, not "unknown"', async () => {
    let serverDownloads = 0;
    const transport = cachedTransport({ [String(DOC_ID)]: 'memory' }, () => { serverDownloads++; });

    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt: EMOJI, docId: String(DOC_ID) }] } }));
    const host = makeHost([emojiMsg(12, EMOJI)]);
    const container = mount(host);
    const router = startRouter(host, transport);

    window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [String(DOC_ID)] } }));
    await settle();
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBe('memory');
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--db')).not.toBeNull();

    host.dispatch({ type: 'CLEAR_EMOJI_DOCUMENTS', keys: ['emojipack-' + DOC_ID] });
    await settle();
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBeUndefined();

    await router.probeEmojiSources([String(DOC_ID)]);
    window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [String(DOC_ID)] } }));
    await settle();
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBe('memory');
    expect(serverDownloads).toBe(0);
  });

  test('scrolling away and back turns a red emoji yellow once it is cached locally', async () => {
    let cached = false;

    let persisted = false;
    const transport = cachedTransport({}, () => { });
    transport.batchCheckDocumentCache = async (documents: Array<{ id: string }>) => {
      if (!persisted) return {};
      const out: Record<string, string> = {};
      for (const d of documents) if (String(d.id) === String(DOC_ID)) out[String(d.id)] = 'memory';
      return out;
    };

    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt: EMOJI, docId: String(DOC_ID) }] } }));
    const host = makeHost([emojiMsg(12, EMOJI)]);
    const container = mount(host);
    const router = startRouter(host, transport);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: emojiDoc(DOC_ID), messageId: 'emojipack-' + DOC_ID, priority: 1 },
    }));
    await settle();
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBe('home-server');
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--srv')).not.toBeNull();

    persisted = true;
    host.dispatch({ type: 'CLEAR_EMOJI_DOCUMENTS', keys: ['emojipack-' + DOC_ID] });
    await settle();

    await router.probeEmojiSources([String(DOC_ID)]);
    window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [String(DOC_ID)] } }));
    await settle();
    expect(host.state().documentSources['emojipack-' + DOC_ID]).toBe('memory');
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--srv')).toBeNull();
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--db')).not.toBeNull();
  });

  test('a document nobody has cached still ends up red, and never claims a cache', async () => {
    let serverDownloads = 0;
    const transport = cachedTransport({}, () => { serverDownloads++; });

    const host = makeHost([stickerMsg(11, 999)]);
    const container = mount(host);
    startRouter(host, transport);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: stickerMsg(11, 999).media.document, messageId: 11, priority: 1 },
    }));
    await settle();

    expect(serverDownloads).toBeGreaterThan(0);
    expect(host.state().documentSources['11']).toBe('home-server');
    expect(container.querySelector('.tgui-sticker-preview .tgui-media-source-badge--srv')).not.toBeNull();
  });
});
