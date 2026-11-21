/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { attachEmojiBurst, attachEmojiInteractions, getBurstStats } from '../dist/components/emoji-burst.js';

function rect(el: Element, left: number, top: number, width: number, height: number): void {
  (el as any).getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => {},
  });
}

function mountEmojiBubble(): HTMLElement {
  document.body.innerHTML = '';
  const row = document.createElement('div');
  row.id = 'msg-7';
  const bubble = document.createElement('div');
  bubble.className = 'MessageBubble';
  bubble.innerHTML = '<span class="tgui-emoji-slot" data-doc="123"><img src="x"></span>';
  row.appendChild(bubble);
  document.body.appendChild(row);
  rect(bubble, 0, 0, 100, 30);
  rect(bubble.querySelector('.tgui-emoji-slot')!, 0, 0, 20, 20);
  return bubble;
}

describe('emoji tap FX source', () => {
  const realAnimate = (Element as any).prototype.animate;

  beforeEach(() => {
    (Element as any).prototype.animate = function () {
      return { finished: new Promise(() => {}), cancel() {} };
    };
    getBurstStats();
  });

  afterEach(() => {
    if (realAnimate) (Element as any).prototype.animate = realAnimate;
    else delete (Element as any).prototype.animate;
    document.body.innerHTML = '';
  });

  test('tap asks only for server FX, without a local burst', () => {
    attachEmojiBurst();
    attachEmojiInteractions();
    const local: any[] = [];
    const requests: any[] = [];
    const onLocal = (e: Event) => local.push((e as CustomEvent).detail);
    const onReq = (e: Event) => requests.push((e as CustomEvent).detail);
    window.addEventListener('tg-interaction-local', onLocal);
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const slot = mountEmojiBubble().querySelector('.tgui-emoji-slot') as HTMLElement;
      slot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].mediaType, 'emoji');
      assert.equal(local.length, 0);
      assert.equal(getBurstStats().spawns, 0);
    } finally {
      window.removeEventListener('tg-interaction-local', onLocal);
      window.removeEventListener('tg-interaction-request', onReq);
    }
  });

  test('local burst still runs as fallback when no server FX arrives', () => {
    attachEmojiBurst();
    attachEmojiInteractions();
    mountEmojiBubble();
    window.dispatchEvent(new CustomEvent('tg-interaction-local', { detail: { messageId: '7', x: 10, y: 10 } }));
    assert.equal(getBurstStats().spawns, 1);
  });
});
