/**
 * @jest-environment jsdom
 */


import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { MessageItem } from '../dist/components/chat-area.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;

(globalThis as any).IntersectionObserver = class {
  constructor(private cb: (entries: any[]) => void) { }
  observe(el: any) { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]); }
  unobserve() { }
  disconnect() { }
  takeRecords() { return []; }
};
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);
let blobSeq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:gift-' + (blobSeq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function stickerDoc(id: number, tgs = false): any {
  return {
    _: 'document',
    id,
    mime_type: tgs ? 'application/x-tgsticker' : 'image/webp',
    size: 1024,
    file_reference: new Uint8Array([1, 2, 3]),
    attributes: [{ _: 'documentAttributeSticker' }],
  };
}

function giftMsg(action: any): any {
  return { id: 71, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null, media: undefined, action };
}

async function mount(msg: any, extra: Record<string, any> = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Comp: any = () => h(MessageItem as any, {
    m: msg, sameSenderPrev: false, sameSenderNext: false, isGroup: false,
    documentUrls: {}, emojiUrls: {}, ...extra,
  });
  render(Comp, container);
  await wait();
  return container;
}

const text = (root: HTMLElement) => (root.textContent || '').replace(/\s+/g, ' ').trim();

describe('every gift action renders as a service message', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  const giftCases: Array<[string, any]> = [
    ['messageActionStarGift', { _: 'messageActionStarGift', gift: { sticker: stickerDoc(900) } }],
    ['messageActionStarGiftUnique', { _: 'messageActionStarGiftUnique', gift: { sticker: stickerDoc(901) } }],
    ['messageActionGiftStars', { _: 'messageActionGiftStars', gift: { sticker: stickerDoc(902) } }],
    ['messageActionGiftPremium', { _: 'messageActionGiftPremium', days: 90 }],
    ['messageActionGiftCode', { _: 'messageActionGiftCode' }],
    ['messageActionGiftTon', { _: 'messageActionGiftTon' }],
    ['messageActionStarGiftPurchaseOffer', { _: 'messageActionStarGiftPurchaseOffer' }],
    ['messageActionStarGiftPurchaseOfferDeclined', { _: 'messageActionStarGiftPurchaseOfferDeclined' }],
  ];

  test.each(giftCases)('%s is recognised as a gift', async (_name, action) => {
    const root = await mount(giftMsg(action));

    expect(root.querySelector('.tgui-msg-row-service')).not.toBeNull();
    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(text(root).length).toBeGreaterThan(0);
  });

  test('a stars gift shows its sticker', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: { sticker: stickerDoc(910) } }), {
      documentUrl: 'blob:gift-910',
      documentSource: 'memory',
    });

    expect(root.querySelector('img')).not.toBeNull();
    expect(root.querySelector('img')!.getAttribute('src')).toBe('blob:gift-910');
  });

  test('a stars gift with no bytes yet asks the worker for its sticker', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };

    await mount(giftMsg({ _: 'messageActionStarGift', gift: { sticker: stickerDoc(911) } }));

    try {
      const download = requested.find((e: any) => e?.type === 'tg-download-document');
      expect(download).toBeDefined();
      expect(String(download.detail.document.id)).toBe('911');
      expect(download.detail.messageId).toBe(71);
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('a gift sticker carries the media source indicator like every other sticker', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: { sticker: stickerDoc(920) } }), {
      documentUrl: 'blob:gift-920',
      documentSource: 'memory',
    });
    const dot = root.querySelector('.tgui-media-source-badge--dot') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('tgui-media-source-badge--db');
    expect(dot!.getAttribute('title')).toBe('in-memory');
  });

  test('an animated gift sticker is rendered through the sticker player, not as an <img>', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: { sticker: stickerDoc(930, true) } }), {
      documentUrl: 'blob:gift-930',
    });
    expect(root.querySelector('img')).toBeNull();

    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(text(root).length).toBeGreaterThan(0);
  });

  test('a gift without a sticker still renders its label rather than nothing', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift' }));
    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(text(root)).toContain('\u{1F381}');
  });

  test('a premium gift keeps its month label', async () => {
    const root = await mount(giftMsg({ _: 'messageActionGiftPremium', days: 90 }));
    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();

    expect(text(root)).toContain('3');
  });

  test('a non-gift action is not swallowed by the gift branch', async () => {
    const root = await mount({
      ...giftMsg({ _: 'messageActionChatCreate', title: 'x' }),
      message: 'plain text that must still render',
    });
    expect(root.querySelector('.tgui-msg-row-service')).toBeNull();
    expect(text(root)).toContain('plain text');
  });
});
