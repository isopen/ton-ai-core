/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { attachEmojiBurst } from '../dist/components/emoji-burst.js';

function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

function mountBubble(inner: string): HTMLElement {
  document.body.innerHTML = '';
  const row = document.createElement('div');
  row.id = 'msg-7';
  const bubble = document.createElement('div');
  bubble.className = 'MessageBubble';
  bubble.innerHTML = inner;
  row.appendChild(bubble);
  document.body.appendChild(row);
  return bubble;
}

describe('emoji tap targeting', () => {
  test('tap on plain text inside emoji wrap fires nothing', async () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = mountBubble(
        '<div class="tgui-emoji-canvas-wrap"><span>hello </span><span class="tgui-emoji-slot" data-doc="123"><img src="x"></span></div>',
      );
      const textSpan = bubble.querySelector('.tgui-emoji-canvas-wrap > span') as HTMLElement;
      textSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      await tick();
      assert.equal(seen.length, 0);
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
      document.body.innerHTML = '';
    }
  });

  test('tap on slot still dispatches with docId', async () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = mountBubble(
        '<div class="tgui-emoji-canvas-wrap"><span>hello </span><span class="tgui-emoji-slot" data-doc="123"><img src="x"></span></div>',
      );
      const slot = bubble.querySelector('.tgui-emoji-slot') as HTMLElement;
      slot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      await tick();
      assert.equal(seen.length, 1);
      assert.equal(seen[0].messageId, '7');
      assert.equal(seen[0].docId, '123');
      assert.equal(seen[0].mediaType, 'emoji');
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
      document.body.innerHTML = '';
    }
  });
});
