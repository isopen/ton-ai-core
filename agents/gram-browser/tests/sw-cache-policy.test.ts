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

  test('hashed bundles go to the network first and fall back to cache', () => {
    const branch = /pathname\.startsWith\('\/static\/'\)[\s\S]*?\n  \}/.exec(src);
    expect(branch).not.toBeNull();

    const body = branch![0];
    expect(body.indexOf('fetch(event.request)')).toBeLessThan(body.indexOf('cache.match'));
    expect(body).toMatch(/cached \|\| response/);
    expect(body).toMatch(/cached \|\| new Response\('', \{ status: 504 \}\)/);
  });
});
