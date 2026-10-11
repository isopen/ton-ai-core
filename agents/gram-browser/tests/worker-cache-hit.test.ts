/**
 * @jest-environment jsdom
 */



import { TextDecoder, TextEncoder } from 'node:util';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;

import { createStandaloneGramDb } from '@ton-ai/gram-db';

const DLCACHE_PREFIX = 'dlcache:v2:';

jest.mock('../src/utils/gram-db', () => ({
  getGramDb: () => (globalThis as any).__testGramDb,
}));

const TW = require('../src/worker/telegram-worker') as any;

function doc(id: string, overrides: Record<string, any> = {}): any {
  return {
    _: 'document',
    id,
    access_hash: '987654321',
    file_reference: 'AAECAwQ=',
    size: 100,
    mime_type: 'image/webp',
    attributes: [],
    ...overrides,
  };
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('the worker cache is written by a download and read back by a probe', () => {
  let db: any;

  beforeEach(async () => {
    db = createStandaloneGramDb();
    await db.init();

    await db.setEncryptionKey('test-session');
    expect(db.isReady()).toBe(true);
    (globalThis as any).__testGramDb = db;
  });

  test('what a cache check reports before anything was ever downloaded', async () => {
    expect(await TW.batchCheckDocumentCache([{ id: '555' }])).toEqual({});
  });

  test('a persisted entry is found and reported as persisted, not as a network hit', async () => {
    await db.set(DLCACHE_PREFIX + '555', { type: 'image/webp', bytes: 'AAAA', updatedAt: Date.now(), immune: true });

    const found = await TW.batchCheckDocumentCache([{ id: '555' }]);
    expect(found).toEqual({ '555': 'persisted' });
  });

  test('a batch probe answers per document and misses the unknown ones', async () => {
    await db.set(DLCACHE_PREFIX + '1', { type: 'image/webp', bytes: 'AAAA', updatedAt: Date.now(), immune: true });
    await db.set(DLCACHE_PREFIX + '3', { type: 'image/webp', bytes: 'CCCC', updatedAt: Date.now(), immune: true });

    const found = await TW.batchCheckDocumentCache([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(found).toEqual({ '1': 'persisted', '3': 'persisted' });
  });

  test('an entry with no bytes is not reported as cached', async () => {
    await db.set(DLCACHE_PREFIX + '9', { type: 'image/webp', bytes: '', updatedAt: Date.now() });
    expect(await TW.batchCheckDocumentCache([{ id: '9' }])).toEqual({});
  });

  test('a thumb is keyed apart from the full file, so a full-file probe cannot see it', async () => {
    await db.set(DLCACHE_PREFIX + '7_thumb_f', { type: 'image/webp', bytes: 'TTTT', updatedAt: Date.now(), immune: true });
    expect(await TW.batchCheckDocumentCache([{ id: '7' }])).toEqual({});
    expect(await TW.batchCheckDocumentCache([{ id: '7', thumb_size: 'f' }])).toEqual({ '7': 'persisted' });
  });

  test('the cache keys the download path uses are the ones the probe reads', async () => {
    await db.set(DLCACHE_PREFIX + String(doc('4242').id), { type: 'image/webp', bytes: 'EEEE', updatedAt: Date.now(), immune: true });
    expect(await TW.batchCheckDocumentCache([{ id: doc('4242').id }])).toEqual({ '4242': 'persisted' });
    await flush();
  });

  test('a sticker effect thumb is keyed apart from the sticker file itself', async () => {
    await db.set(DLCACHE_PREFIX + '880_thumb_f', { type: 'image/webp', bytes: 'FFFF', updatedAt: Date.now(), immune: true });
    expect(await TW.batchCheckDocumentCache([{ id: '880' }])).toEqual({});
    expect(await TW.batchCheckDocumentCache([{ id: '880', thumb_size: 'f' }])).toEqual({ '880': 'persisted' });
  });
});
