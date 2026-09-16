/** @jest-environment jsdom */

import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport } from './helpers.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>';

function gzipBytes(text: string): ArrayBuffer {
  const { gzipSync } = require('zlib');
  const out: Buffer = gzipSync(Buffer.from(text, 'utf8'));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer as ArrayBuffer;
}

function streamsWork(): boolean {
  try {
    const DS = (globalThis as any).DecompressionStream;
    if (typeof DS !== 'function') return false;
    const b = new Blob([new Uint8Array([1])]);
    return typeof (b as any).stream === 'function' && typeof ReadableStream !== 'undefined';
  } catch {
    return false;
  }
}

function svgBuffer(): ArrayBuffer {
  const buf = Buffer.from(SVG, 'utf8');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('wallpaper pattern documents', () => {
  test('gzipped svg pattern resolves to svg image', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    const seen: Array<{ text: string; mime: string }> = [];
    (router as any).bytesToBlobUrl = (b: ArrayBuffer, m: string) => {
      seen.push({ text: Buffer.from(b).toString('utf8'), mime: m });
      return 'blob:pattern';
    };
    const out = await router.emojiKindAndUrlFor(gzipBytes(SVG), 'application/x-tgwallpattern');
    expect(out.kind).toBe('img');
    expect(out.url).toBe('blob:pattern');
    expect(seen.length).toBe(1);
    if (streamsWork()) {
      expect(seen[0].mime).toBe('image/svg+xml');
      expect(seen[0].text.startsWith('<svg')).toBe(true);
    } else {
      expect(seen[0].mime).toBe('image/png');
    }
  });

  test('png pattern passes through as png', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    const seen: Array<{ mime: string }> = [];
    (router as any).bytesToBlobUrl = (b: ArrayBuffer, m: string) => {
      seen.push({ mime: m });
      return 'blob:png';
    };
    const out = await router.emojiKindAndUrlFor(pngBytes(), 'application/x-tgwallpattern');
    expect(out.kind).toBe('img');
    expect(seen[0].mime).toBe('image/png');
  });

  test('plain svg pattern passes through as svg', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    const seen: Array<{ mime: string }> = [];
    (router as any).bytesToBlobUrl = (b: ArrayBuffer, m: string) => {
      seen.push({ mime: m });
      return 'blob:svg';
    };
    const buf = Buffer.from(SVG, 'utf8');
    const out = await router.emojiKindAndUrlFor(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      'application/x-tgwallpattern',
    );
    expect(out.kind).toBe('img');
    expect(seen[0].mime).toBe('image/svg+xml');
  });

  test('gzip tgs keeps tgs path for other mimes', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    const out = await router.emojiKindAndUrlFor(gzipBytes('{"v":"5.7.0"}'), 'application/x-tgsticker');
    expect(out.kind).toBe('tgs');
  });

  test('inflated gzip pattern resolves to svg content', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    (router as any).inflateGzipBytes = async () => svgBuffer();
    const seen: Array<{ text: string; mime: string }> = [];
    (router as any).bytesToBlobUrl = (b: ArrayBuffer, m: string) => {
      seen.push({ text: Buffer.from(b).toString('utf8'), mime: m });
      return 'blob:inflated';
    };
    const out = await router.wallpaperPatternToSvgUrl(gzipBytes(SVG));
    expect(out).toBe('blob:inflated');
    expect(seen.length).toBe(1);
    expect(seen[0].mime).toBe('image/svg+xml');
    expect(seen[0].text.startsWith('<svg')).toBe(true);
  });

  test('inflate returns null without platform streams', async () => {
    const { host } = makeHost();
    const router = new GramMediaRouter(host);
    if (streamsWork()) return;
    const out = await router.inflateGzipBytes(gzipBytes(SVG));
    expect(out).toBeNull();
  });

  test('transport is constructible', () => {
    expect(makeTransport()).toBeTruthy();
  });
});
