/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { attachEmojiBurst, attachEmojiInteractions } from '../dist/components/emoji-burst.js';

function mountSticker(flagged: boolean): HTMLElement {
  document.body.innerHTML = '';
  const row = document.createElement('div');
  row.id = 'msg-9';
  const bubble = document.createElement('div');
  bubble.className = 'MessageBubble';
  bubble.innerHTML =
    '<div class="tgui-sticker"' + (flagged ? ' data-server-fx="1"' : '') + '><div class="tgui-sticker-preview">' +
    '<canvas class="tgui-animated-sticker" width="64" height="64"></canvas>' +
    '<img src="https://example.com/sticker.webp">' +
    '</div></div>';
  row.appendChild(bubble);
  document.body.appendChild(row);
  return bubble;
}

function mountStickerVideo(id: string, flagged: boolean): HTMLElement {
  document.body.innerHTML = '';
  const row = document.createElement('div');
  row.id = id;
  const bubble = document.createElement('div');
  bubble.className = 'MessageBubble';
  bubble.innerHTML =
    '<div class="tgui-sticker"' + (flagged ? ' data-server-fx="1"' : '') + '><div class="tgui-sticker-preview">' +
    '<video src="https://example.com/sticker.mp4"></video>' +
    '</div></div>';
  row.appendChild(bubble);
  document.body.appendChild(row);
  return bubble;
}

function burstCount(): number {
  const layer = document.querySelector('.tg-emoji-burst-layer');
  return layer ? layer.childElementCount : 0;
}

describe('sticker tap burst like emoji', () => {
  const realAnimate = (Element as any).prototype.animate;
  const realPlay = (window.HTMLVideoElement as any).prototype.play;
  beforeEach(() => {
    jest.useFakeTimers();
    (Element as any).prototype.animate = function () {
      return { finished: new Promise(() => {}), cancel() {} };
    };
    (window.HTMLVideoElement as any).prototype.play = function () {
      return Promise.resolve();
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    if (realAnimate) (Element as any).prototype.animate = realAnimate;
    else delete (Element as any).prototype.animate;
    if (realPlay) (window.HTMLVideoElement as any).prototype.play = realPlay;
    else delete (window.HTMLVideoElement as any).prototype.play;
    document.body.innerHTML = '';
  });

  test('single tap spawns burst particles and dispatches sticker request', () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = mountSticker(false);
      const img = bubble.querySelector('.tgui-sticker img') as HTMLElement;
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      jest.advanceTimersByTime(500);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].mediaType, 'sticker');
      assert.equal(seen[0].messageId, '9');
      assert.ok(burstCount() >= 7);
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
    }
  });

  test('repeated taps escalate particle count like emoji taps', () => {
    attachEmojiBurst();
    const bubble = mountSticker(false);
    const img = bubble.querySelector('.tgui-sticker img') as HTMLElement;
    const click = () => img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    click();
    jest.advanceTimersByTime(300);
    const first = burstCount();
    click();
    jest.advanceTimersByTime(300);
    click();
    jest.advanceTimersByTime(1000);
    const total = burstCount();
    assert.ok(first >= 7);
    assert.ok(total > first + 10);
  });

  test('flagged sticker tap dispatches but spawns no local burst', () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = mountSticker(true);
      const img = bubble.querySelector('.tgui-sticker img') as HTMLElement;
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      jest.advanceTimersByTime(500);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].mediaType, 'sticker');
      assert.equal(burstCount(), 0);
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
    }
  });

  test('local interaction event stays silent on flagged sticker, bursts otherwise', () => {
    attachEmojiInteractions();
    mountStickerVideo('msg-11', true);
    window.dispatchEvent(new CustomEvent('tg-interaction-local', { detail: { messageId: '11', x: 10, y: 10 } }));
    jest.advanceTimersByTime(800);
    assert.equal(burstCount(), 0);
    mountStickerVideo('msg-12', false);
    window.dispatchEvent(new CustomEvent('tg-interaction-local', { detail: { messageId: '12', x: 10, y: 10 } }));
    jest.advanceTimersByTime(800);
    assert.ok(burstCount() > 0);
  });
});
