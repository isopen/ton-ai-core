/**
 * @jest-environment jsdom
 */



import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MainThreadRenderer } from '../src/utils/animated-renderer/main-thread-renderer';
import type { AnimatedRendererParams } from '../src/utils/animated-renderer/types';

const PARAMS: AnimatedRendererParams = { size: 32 };

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../tgs/tests/fixtures', name), 'utf8');
}

const tick = (n = 6) => new Promise<void>((r) => {
  let left = n;
  const step = () => (left-- > 0 ? setTimeout(step, 0) : r());
  step();
});

describe('a render id reused for another document does not keep the old one', () => {
  const requested: string[] = [];
  const realFetch = (globalThis as any).fetch;
  const realGetContext = (globalThis as any).HTMLCanvasElement?.prototype?.getContext;

  beforeAll(() => {
    (globalThis as any).fetch = async (url: string) => {
      requested.push(String(url));
      const body = url.includes('gift-a') ? fixture('emoji_wink.json') : fixture('emoji_shock.json');
      return { headers: { get: () => 'application/json' }, text: async () => body } as any;
    };

    if (realGetContext) {
      (globalThis as any).HTMLCanvasElement.prototype.getContext = () => ({});
    }
  });

  afterAll(() => {
    (globalThis as any).fetch = realFetch;
    if (realGetContext) (globalThis as any).HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  beforeEach(() => { requested.length = 0; });

  test('the main-thread renderer loads the new document into the instance it reuses', async () => {
    const renderId = 'gift-renderer-identity-main';

    const first = MainThreadRenderer.init('blob:gift-a', document.createElement('div'), renderId, PARAMS, 'view-a');
    await tick();
    const wink = (first as any).anim;
    expect(wink).toBeTruthy();

    first.removeView('view-a');
    expect((first as any).isDestroyed).toBeFalsy();

    const second = MainThreadRenderer.init('blob:gift-b', document.createElement('div'), renderId, PARAMS, 'view-b');

    expect(second).toBe(first);
    await tick();

    expect(requested).toContain('blob:gift-b');
    const shock = (second as any).anim;
    expect(shock).toBeTruthy();

    expect(JSON.stringify(shock)).not.toBe(JSON.stringify(wink));

    second.destroy();
  });

  test('the instance is repointed at the url it was just given', async () => {
    const renderId = 'gift-renderer-identity-url';
    const inst = MainThreadRenderer.init('blob:gift-a', document.createElement('div'), renderId, PARAMS, 'view-a');
    await tick();
    inst.removeView('view-a');

    MainThreadRenderer.init('blob:gift-b', document.createElement('div'), renderId, PARAMS, 'view-b');
    expect((inst as any).tgsUrl).toBe('blob:gift-b');
    inst.destroy();
  });

  test('the worker renderer re-initialises instead of keeping the animation', () => {
    const src = readFileSync(require.resolve('../src/utils/animated-renderer/tgs-renderer.ts'), 'utf8');
    expect(src).toMatch(/needsChangeData/);
    expect(src).toMatch(/this\.needsChangeData \? 'tgs:changeData' : 'tgs:init'/);

    expect(src).toMatch(/initGeneration\+\+/);
  });

  test('the gift sheet names the renderer after the document, not after the surface', () => {
    const src = readFileSync(require.resolve('../src/components/gift-detail.tsx'), 'utf8');
    expect(src).not.toMatch(/renderId="giftdetail"/);
    expect(src).toMatch(/const renderId = 'giftdetail-'/);
    expect(src).toMatch(/renderId=\{renderId\}/);
  });
});
