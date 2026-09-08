/**
 * @jest-environment jsdom
 */

import { initCacheState, cacheReducer } from '../src/components/cache-view.js';

function loadedState() {
  return cacheReducer(initCacheState(), {
    type: 'LOADED',
    data: {
      dbKeys: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
      opfsRoot: [{ name: 'f1', size: 10 }],
      opfs7a: [{ name: 'f2', size: 20 }],
      binlogInfo: { size: 5, exists: true, events: [] },
      avatars: [{ opfsName: 'av1', dataUri: 'data:' }],
    },
  });
}

describe('cacheReducer', () => {
  test('initial state is loading without data', () => {
    const s = initCacheState();
    expect(s.loading).toBe(true);
    expect(s.data).toBeNull();
  });

  test('LOADING and LOADED cycle', () => {
    let s = initCacheState();
    s = cacheReducer(s, { type: 'LOADING' });
    expect(s.loading).toBe(true);
    s = loadedState();
    expect(s.loading).toBe(false);
    expect(s.data?.dbKeys.length).toBe(2);
  });

  test('LOAD_FAILED stops loading keeping data', () => {
    let s = loadedState();
    s = cacheReducer(s, { type: 'LOADING' });
    s = cacheReducer(s, { type: 'LOAD_FAILED' });
    expect(s.loading).toBe(false);
    expect(s.data?.dbKeys.length).toBe(2);
  });

  test('TOGGLE_SEC flips one section', () => {
    let s = initCacheState();
    s = cacheReducer(s, { type: 'TOGGLE_SEC', key: 'db' });
    expect(s.sec.db).toBe(true);
    expect(s.sec.opfs).toBe(false);
    s = cacheReducer(s, { type: 'TOGGLE_SEC', key: 'db' });
    expect(s.sec.db).toBe(false);
  });

  test('delete actions filter collections', () => {
    let s = loadedState();
    s = cacheReducer(s, { type: 'DELETE_KEY', key: 'a' });
    expect(s.data?.dbKeys.map((e) => e.key)).toEqual(['b']);
    s = cacheReducer(s, { type: 'DELETE_OPFS', dir: 'root', name: 'f1' });
    expect(s.data?.opfsRoot).toEqual([]);
    s = cacheReducer(s, { type: 'DELETE_OPFS', dir: '_7a', name: 'f2' });
    expect(s.data?.opfs7a).toEqual([]);
    s = cacheReducer(s, { type: 'DELETE_AVATAR', name: 'av1' });
    expect(s.data?.avatars).toEqual([]);
    s = cacheReducer(s, { type: 'DELETE_BINLOG', target: 'binlog' });
    expect(s.data?.binlogInfo.exists).toBe(false);
    s = cacheReducer(s, { type: 'DELETE_BINLOG', target: 'other' });
    expect(s.data?.binlogInfo.exists).toBe(false);
  });

  test('delete on empty state is identity', () => {
    const s = initCacheState();
    expect(cacheReducer(s, { type: 'DELETE_KEY', key: 'a' })).toBe(s);
    expect(cacheReducer(s, { type: 'CLEAR_AVATARS' })).toBe(s);
  });
});
