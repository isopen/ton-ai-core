/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { playStickerFxOverlay, disposeStickerFxOverlay } from '../dist/components/animated-sticker.js';

function hosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.tgui-sticker-fx-overlay')) as HTMLElement[];
}

describe('sticker server fx layering like emoji', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('same key restarts single overlay', () => {
    document.body.innerHTML = '';
    playStickerFxOverlay('fx9', 'blob:http://localhost/fx', null, { left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    playStickerFxOverlay('fx9', 'blob:http://localhost/fx', null, { left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    assert.equal(hosts().length, 1);
    disposeStickerFxOverlay('fx9');
    assert.equal(hosts().length, 0);
  });

  test('unique per-tap keys stack overlays', () => {
    document.body.innerHTML = '';
    const keys = ['fx9_1', 'fx9_2', 'fx9_3'];
    for (const k of keys) {
      playStickerFxOverlay(k, 'blob:http://localhost/fx', null, { left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    }
    assert.equal(hosts().length, 3);
    for (const k of keys) disposeStickerFxOverlay(k);
    assert.equal(hosts().length, 0);
  });
});
