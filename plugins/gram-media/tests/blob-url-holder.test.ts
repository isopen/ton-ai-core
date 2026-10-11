/** @jest-environment jsdom */

import { GramMediaRouter } from '../src/router.js';
import { makeHost } from './helpers.js';

describe('blob urls held outside the router survive the eviction sweep', () => {
  function make() {
    const { host } = makeHost();
    const router = new GramMediaRouter(host) as any;

    router.activeBlobUrls = new Set<string>();
    return router;
  }

  test('a held url is not revoked while the holder keeps it', () => {
    const router = make();
    const url = router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([1])])) as string);

    const release = router.retainBlobUrl(url);

    for (let i = 0; i < 5000; i++) {
      router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([i % 7])])) as string);
    }
    expect(router.activeBlobUrls.has(url)).toBe(true);
    release();
  });

  test('an unreleased url becomes evictable again', () => {
    const router = make();
    const url = router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([2])])) as string);
    router.retainBlobUrl(url)();

    for (let i = 0; i < 5000; i++) {
      router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([i % 5])])) as string);
    }
    expect(router.activeBlobUrls.has(url)).toBe(false);
  });

  test('two holders of one url need both to let go', () => {
    const router = make();
    const url = router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([3])])) as string);
    const a = router.retainBlobUrl(url);
    const b = router.retainBlobUrl(url);
    a();

    for (let i = 0; i < 5000; i++) {
      router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([i % 3])])) as string);
    }

    expect(router.activeBlobUrls.has(url)).toBe(true);
    b();
  });

  test('releasing twice does not unbalance the count', () => {
    const router = make();
    const url = router.trackBlobUrl(URL.createObjectURL(new Blob([new Uint8Array([4])])) as string);
    const release = router.retainBlobUrl(url);
    release();
    release();
    expect(router.externalBlobUrlHolders.has(url)).toBe(false);
  });
});
