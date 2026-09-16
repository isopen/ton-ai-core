/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { attachEmojiInteractions } from '../dist/components/emoji-burst.js';

function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('server fx overlay anchor', () => {
  test('exact point tap centers overlay on tap coordinates', async () => {
    attachEmojiInteractions();
    document.body.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.id = 'msg-42';
    bubble.innerHTML = '<span>hi</span>';
    document.body.appendChild(bubble);
    window.dispatchEvent(new CustomEvent('tg-interaction-server-fx', {
      detail: { messageId: '42', url: 'blob:http://localhost/x', key: 'k1', x: 400, y: 300, exact: true },
    }));
    await tick();
    const host = document.body.querySelector('.tgui-sticker-fx-overlay') as HTMLElement | null;
    assert.ok(host, 'overlay host mounted');
    assert.equal(host.style.left, '250px');
    assert.equal(host.style.top, '150px');
    window.dispatchEvent(new Event('scroll'));
    await tick();
    assert.equal(host.isConnected, true);
    assert.equal(host.style.left, '250px');
    assert.equal(host.style.top, '150px');
    document.body.innerHTML = '';
  });

  test('non-exact tap still anchors to nearest emoji slot', async () => {
    attachEmojiInteractions();
    document.body.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.id = 'msg-43';
    const slot = document.createElement('span');
    slot.className = 'tgui-emoji-slot';
    slot.setAttribute('data-doc', '1001');
    bubble.appendChild(slot);
    document.body.appendChild(bubble);
    slot.getBoundingClientRect = () => ({ left: 100, top: 100, width: 40, height: 40, right: 140, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new CustomEvent('tg-interaction-server-fx', {
      detail: { messageId: '43', url: 'blob:http://localhost/y', key: 'k2', x: 400, y: 300 },
    }));
    await tick();
    const host = document.body.querySelector('.tgui-sticker-fx-overlay') as HTMLElement | null;
    assert.ok(host, 'overlay host mounted');
    assert.equal(host.style.left, '-30px');
    assert.equal(host.style.top, '-30px');
    document.body.removeChild(bubble);
    host.remove();
  });
});
