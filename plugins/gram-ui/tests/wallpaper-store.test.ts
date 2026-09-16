/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { setGramDb, getGramDb } from '@ton-ai/gram-db';

const store = new Map<string, any>();
setGramDb({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: any) => { store.set(k, v); },
} as any);
assert.equal(getGramDb() !== null, true);

import {
  saveDefaultWallpaper,
  loadDefaultWallpaper,
  resetDefaultWallpaperCache,
  freezeWallpaper,
  thawWallpaper,
} from '../dist/components/wallpaper-store.js';

function hasBigInt(v: any): boolean {
  if (typeof v === 'bigint') return true;
  if (Array.isArray(v)) return v.some(hasBigInt);
  if (v && typeof v === 'object') return Object.values(v).some(hasBigInt);
  return false;
}

const WALL = {
  _: 'wallPaper',
  id: BigInt('5911321041770119175'),
  slug: 's9',
  access_hash: BigInt('123'),
  document: { _: 'document', id: BigInt('5911348641229966652'), mime_type: 'image/jpeg' },
  settings: { background_color: 112, second_background_color: 34, intensity: -50 },
};

describe('wallpaper gram-db roundtrip with bigint ids', () => {
  beforeEach(() => {
    store.clear();
    resetDefaultWallpaperCache();
  });

  test('frozen form holds no bigint and stringifies', () => {
    const frozen = freezeWallpaper(WALL);
    assert.equal(hasBigInt(frozen), false);
    assert.doesNotThrow(() => JSON.stringify(frozen));
  });

  test('thaw restores bigint ids exactly', () => {
    const restored = thawWallpaper(freezeWallpaper(WALL));
    assert.deepStrictEqual(restored, WALL);
  });

  test('save then load across sessions keeps wallpaper', async () => {
    await saveDefaultWallpaper(WALL);
    const stored = store.get('tg-default-wallpaper');
    assert.equal(hasBigInt(stored), false);
    assert.doesNotThrow(() => JSON.stringify(stored));
    resetDefaultWallpaperCache();
    const loaded = await loadDefaultWallpaper();
    assert.deepStrictEqual(loaded, WALL);
  });

  test('clearing default roundtrips null', async () => {
    await saveDefaultWallpaper(WALL);
    await saveDefaultWallpaper(null);
    resetDefaultWallpaperCache();
    assert.equal(await loadDefaultWallpaper(), null);
  });
});
