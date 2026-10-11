/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
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
(globalThis as any).URL.createObjectURL = () => 'blob:r-' + (seq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const peer = { type: 'user', id: 7, accessHash: '22' };
const DOC = '777';
const KEY = 'emojipack-' + DOC;

function builtFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist', rel), 'utf8');
}

function serverTransport(): any {
  return {
    callRpc: async () => ({}),
    downloadFile: async () => ({ bytes: new Uint8Array(1024).buffer, fileType: 'image/webp', cacheSource: 'home-server' }),
    downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({ index, bytes: new Uint8Array(1024).buffer, type: 'image/webp', cacheSource: 'home-server' })),
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
    dispatch: (a: any) => { const n = reducer(state, a); if (n === state) return; state = n; for (const cb of Array.from(listeners)) cb(); },
  };
}

function mountChat(hs: any): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const Host: any = () => {
    const [t, setT] = useState(0);
    useEffect(() => hs.subscribe(() => setT((v: number) => v + 1)), []);
    void t;
    return h(ChatArea as any, { state: hs.state(), dispatch: () => { }, skills: [] });
  };
  render(Host, c);
  return c;
}

async function renderAndDownload(msg: any): Promise<{ container: HTMLElement; sources: any }> {
  const hs = makeHost([msg]);
  const container = mountChat(hs);
  const router = new GramMediaRouter({
    tgService: { current: serverTransport() },
    dispatch: hs.dispatch,
    selectedPeerRef: { current: null },
    cleanupFns: [],
    debug: false,
  } as any);
  router.attach();
  window.dispatchEvent(new CustomEvent('tg-download-document', {
    detail: {
      document: { _: 'document', id: 777, mime_type: 'image/webp', size: 100, file_reference: new Uint8Array([1, 2, 3]) },
      messageId: KEY,
      priority: 1,
    },
  }));
  await new Promise((r) => setTimeout(r, 700));
  return { container, sources: hs.state().documentSources };
}

describe('indicator reaches every chat render path after a server download', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt: '\u{1F3C6}', docId: DOC }] } }));
  });

  test('TMD custom emoji entity is mounted and gets its dot', async () => {
    const { container, sources } = await renderAndDownload({
      id: 4, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
      message: '**ab** rest',
      entities: [{ _: 'messageEntityCustomEmoji', document_id: 777, offset: 0, length: 2 }],
    });
    expect(sources[KEY]).toBe('home-server');
    expect(container.querySelectorAll('.tmd-body')).toHaveLength(1);
    const span = container.querySelector('.md-emoji-custom[data-doc-id]') as HTMLElement;
    expect(span).not.toBeNull();
    expect((span.innerHTML || '').length).toBeGreaterThan(0);
    expect(span.querySelector('.tgui-media-source-badge--srv')).not.toBeNull();
  });

  test('TmdView queries the class the renderer actually emits', () => {
    const src = builtFile('components/tmd-view.js');
    expect(src).toContain('md-emoji-custom[data-doc-id]');
    expect(src).toContain('tmd-emoji-custom[data-doc-id]');
  });

  test('plain text message gets its dot', async () => {
    const { container } = await renderAndDownload({
      id: 1, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
      message: 'prize \u{1F3C6}',
    });
    expect(container.querySelector('.tgui-emoji-slot .tgui-media-source-badge--srv')).not.toBeNull();
  });

  test('remount keys and effect deps account for the source', () => {
    expect((builtFile('components/tmd-view.js').match(/\|' \+ src/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(builtFile('components/inline-keyboard.js')).toContain("'|' + src");
    for (const f of ['components/tmd-view.js', 'components/inline-keyboard.js']) {
      expect(builtFile(f)).toMatch(/\[(html, )?documentUrls, documentSources/);
    }
  });
});
