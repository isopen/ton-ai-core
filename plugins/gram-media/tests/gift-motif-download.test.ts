/** @jest-environment jsdom */

import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport, makeDocument, makeBytes, flushTicks } from './helpers.js';

function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer as ArrayBuffer;
}

function setup(download: Array<{ type: string; bytes: ArrayBuffer }>) {
  const { host, setTransport } = makeHost();
  const router = new GramMediaRouter(host);
  router.attach();
  setTransport(makeTransport({
    downloadFile: async () => {
      const next = download.shift();
      return next
        ? { bytes: next.bytes, type: next.type, cacheSource: 'home-server' }
        : null;
    },
  } as any));

  const urls: any[] = [];
  const kinds: any[] = [];
  window.addEventListener('tg-emoji-url', (e) => urls.push((e as CustomEvent).detail));
  window.addEventListener('tg-emoji-url-kind', (e) => kinds.push((e as CustomEvent).detail));
  return { router, urls, kinds, cleanup: () => (router as any).detach?.() };
}

describe('a gift motif reaches the card as a usable image url', () => {
  test('a png motif is announced under its own document id', async () => {
    const doc = makeDocument({ id: '9001', mime_type: 'image/png' });
    const { urls } = setup([{ type: 'image/png', bytes: pngBytes() }]);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: 'gift-pattern-9001', priority: 1 },
    }));
    await flushTicks(6);

    const hit = urls.find((u) => String(u?.docId) === '9001');
    expect(hit).toBeDefined();
    expect(String(hit!.url)).toMatch(/^blob:/);
    expect(String(hit!.kind)).toBe('img');
  });

  test('a wallpaper-pattern motif is converted and still announced', async () => {
    const doc = makeDocument({ id: '9002', mime_type: 'application/x-tgwallpattern' });
    const { urls } = setup([{ type: 'application/x-tgwallpattern', bytes: pngBytes() }]);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: 'gift-pattern-9002', priority: 1 },
    }));
    await flushTicks(6);

    const hit = urls.find((u) => String(u?.docId) === '9002');
    expect(hit).toBeDefined();
    expect(String(hit!.url)).toMatch(/^blob:/);
  });

  test('two motifs on screen do not answer each other', async () => {
    const first = makeDocument({ id: '9003', mime_type: 'image/png' });
    const second = makeDocument({ id: '9004', mime_type: 'image/png' });
    const { urls } = setup([
      { type: 'image/png', bytes: pngBytes() },
      { type: 'image/png', bytes: pngBytes() },
    ]);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: first, messageId: 'gift-pattern-9003', priority: 1 },
    }));
    await flushTicks(4);
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: second, messageId: 'gift-pattern-9004', priority: 1 },
    }));
    await flushTicks(6);

    const firstUrl = urls.find((u) => String(u?.docId) === '9003')?.url;
    const secondUrl = urls.find((u) => String(u?.docId) === '9004')?.url;
    expect(String(firstUrl)).toMatch(/^blob:/);
    expect(String(secondUrl)).toMatch(/^blob:/);
  });
});

describe('a lottie motif arrives as something the renderer can read', () => {
  test('a tgs motif is announced with a url under its own document id', async () => {
    const doc = makeDocument({ id: '9010', mime_type: 'application/x-tgsticker' });
    const { urls } = setup([{ type: 'application/x-tgsticker', bytes: pngBytes() }]);

    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: 'gift-pattern-frame-9010', priority: 1 },
    }));
    await flushTicks(6);

    const hit = urls.find((u) => String(u?.docId) === '9010');
    expect(hit).toBeDefined();
    expect(String(hit!.url)).toMatch(/^blob:/);
    expect(String(hit!.url)).not.toBe('');
  });
});
