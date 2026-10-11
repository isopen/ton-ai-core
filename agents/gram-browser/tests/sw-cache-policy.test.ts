import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../public/sw.js'), 'utf8');

describe('the service worker does not pin an old build', () => {
  test('navigations go to the network first, cache only as a fallback', () => {
    const nav = /mode === 'navigate'\)\s*\{[\s\S]*?\n  \}/.exec(src);
    expect(nav).not.toBeNull();

    const body = nav![0];
    expect(body.indexOf('fetch(event.request)')).toBeLessThan(body.indexOf('caches.match'));
  });

  test('install precaches nothing that does not exist', () => {
    expect(src).not.toMatch(/cache\.addAll\(/);
    expect(src).not.toMatch(/__WB_MANIFEST/);
  });

  test('hashed bundles may be served from cache', () => {
    expect(src).toMatch(/pathname\.startsWith\('\/static\/'\)/);
    expect(src).toMatch(/return cached \|\| networkFetch/);
  });
});
