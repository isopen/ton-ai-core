/**
 * @jest-environment jsdom
 */


import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { MessageItem } from '../dist/components/chat-area.js';
import { describeGift, giftStickerResolution } from '../dist/components/gift-card.js';
import { giftStickerSlug } from '../dist/components/gift-shared.js';
import { giftArtworkDocument, giftVisualKind } from '../dist/components/gift-shared.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);
let blobSeq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:gc-' + (blobSeq++);
(globalThis as any).URL.revokeObjectURL = () => { };

(globalThis as any).IntersectionObserver = class {
  constructor(private cb: (entries: any[]) => void) { }
  observe(el: any) { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]); }
  unobserve() { }
  disconnect() { }
  takeRecords() { return []; }
};

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

function animatedStickerDoc(id: number): any {
  return {
    _: 'document',
    id,
    mime_type: 'video/webm',
    size: 4096,
    file_reference: new Uint8Array([4, 5, 6]),
    attributes: [{ _: 'documentAttributeAnimated' }, { _: 'documentAttributeSticker' }],
  };
}

function starGift(over: Record<string, any> = {}): any {
  return {
    _: 'starGift',
    id: 5150,
    sticker: stickerDoc(5150),
    stars: 25,
    title: 'Plush Pepe',
    limited: true,
    sold_out: false,
    availability_remains: 12,
    availability_total: 100,
    background: { _: 'starGiftBackground', center_color: 0x3355ff, edge_color: 0x7722aa, text_color: 0xffffff },
    ...over,
  };
}

function giftMsg(action: any, extra: Record<string, any> = {}): any {
  return { id: 81, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null, action, ...extra };
}

function giftWebPageMsg(gift: any, extra: Record<string, any> = {}): any {
  return {
    id: 82, fromId: null, sender: 'u', date: 1700000000, out: false, peerId: null,
    media: {
      _: 'messageMediaWebPage',
      webpage: {
        _: 'webPage',
        url: 'https://t.me/nft/PlushPepe-2050',
        display_url: 't.me/nft/PlushPepe-2050',
        site_name: 'Telegram',
        title: 'Plush Pepe #2050',
        description: 'Gifted to Kallen T on 1 Dec 2024',
        type: 'telegram_nft_gift',
        attributes: [{ _: 'webPageAttributeUniqueStarGift', gift }],
        ...((extra as any).__wp || {}),
      },
    },
    ...extra,
  };
}

function emptyRefSticker(id: number): any {
  return { _: 'documentEmpty', id };
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

async function openSheet(giftOver: Record<string, any> = {}) {
  const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5160), ...giftOver }));
  msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art-4242' }] };
  const root = await mount(msg);
  (root.querySelector('.tgui-gift-card__action') as HTMLButtonElement).click();
  await wait();
  return document.body.querySelector('.tgui-gift-detail') as HTMLElement | null;
}

const text = (root: HTMLElement) => (root.textContent || '').replace(/\s+/g, ' ').trim();

describe('a gift renders as a gift card, not as a link preview', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  test('a collectible gift arriving as a webpage becomes a gift card', async () => {
    const root = await mount(giftWebPageMsg(starGift()));
    expect(root.querySelector('.tgui-gift-card')).not.toBeNull();

    expect(root.querySelector('.tgui-webpage')).toBeNull();
    expect(text(root)).toContain('Plush Pepe');
  });

  test('the card shows what Telegram Desktop shows: the gift title and its availability', async () => {
    const root = await mount(giftWebPageMsg(starGift()));
    const card = root.querySelector('.tgui-gift-card') as HTMLElement;
    const body = (card.textContent || '').replace(/\s+/g, ' ');
    expect(body).toContain('Plush Pepe');

    expect(body).toMatch(/12/);
    expect(body).toMatch(/100/);
  });

  test('the card paints the colours the gift carries', async () => {
    const root = await mount(giftWebPageMsg(starGift()));

    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    const style = media.getAttribute('style') || '';
    expect(style).toMatch(/--gift-edge-color/);
    expect(style).toMatch(/--gift-center-color/);
    expect(media.querySelector('.tgui-gift-backdrop__halo')).not.toBeNull();
    expect(media.querySelector('canvas.tgui-gift-backdrop__motif')).not.toBeNull();
  });

  test('a sold out gift says so instead of pretending it is available', async () => {
    const root = await mount(giftWebPageMsg(starGift({ sold_out: true, availability_remains: 0 })));
    const card = (root.querySelector('.tgui-gift-card') as HTMLElement).textContent || '';
    expect(card.replace(/\s+/g, ' ')).toMatch(/sold out|unavailable/i);
  });

  test('an ordinary link preview is still a link preview', async () => {
    const root = await mount({
      id: 83, fromId: null, sender: 'u', date: 1700000000, out: false,
      media: {
        _: 'messageMediaWebPage',
        webpage: {
          _: 'webPage', url: 'https://example.com/x', display_url: 'example.com',
          site_name: 'Example', title: 'A page', description: 'Just a page',
          attributes: [{ _: 'webPageAttributeTheme', ...{} }],
        },
      },
    });
    expect(root.querySelector('.tgui-gift-card')).toBeNull();
    expect(text(root)).toContain('A page');
  });

  test('a stars gift action renders a card too, and keeps the sender comment', async () => {
    const root = await mount(giftMsg({
      _: 'messageActionStarGift',
      gift: starGift(),
      message: { _: 'textWithEntities', text: 'happy birthday!' },
    }));
    expect(root.querySelector('.tgui-gift-card')).not.toBeNull();

    expect(text(root)).toContain('happy birthday!');
    expect(text(root)).toContain('Plush Pepe');
  });

  test('a gift card reports where its sticker bytes came from', async () => {
    const root = await mount(giftWebPageMsg(starGift()), { documentUrl: 'blob:gc-1', documentSource: 'memory' });
    const dot = root.querySelector('.tgui-gift-card .tgui-media-source-badge--dot') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('tgui-media-source-badge--db');
  });

  test('a service gift with no card content still renders as a service message', async () => {
    const root = await mount(giftMsg({ _: 'messageActionGiftCode' }));
    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(text(root).length).toBeGreaterThan(0);
  });
});

describe('which shape a gift arrived in is reported, not guessed', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('a gift page whose attributes never arrived still becomes a card', async () => {
    const msg = giftWebPageMsg(starGift());
    delete (msg.media.webpage as any).attributes;
    const root = await mount(msg);
    expect(root.querySelector('.tgui-gift-card')).not.toBeNull();
    expect(root.querySelector('.tgui-webpage')).toBeNull();
    expect(text(root)).toContain('Plush Pepe #2050');
  });

  test('an ordinary page is left alone, whatever its attributes say', () => {
    const page = { _: 'webPage', url: 'https://example.com/x', title: 'A page' };
    expect(describeGift({ media: { webpage: page } }).via).toBe('none');
  });

  test('the shape a gift arrived in is named', () => {
    expect(describeGift(giftWebPageMsg(starGift())).via).toBe('webPageAttributeUniqueStarGift');
    expect(describeGift(giftMsg({ _: 'messageActionStarGift', gift: starGift() })).via).toBe('action');
  });

  test('a gift action carrying no StarGift is not treated as a card', () => {
    expect(describeGift(giftMsg({ _: 'messageActionGiftPremium', days: 90 })).gift).toBeUndefined();
    expect(describeGift(giftMsg({ _: 'messageActionStarGift' })).gift).toBeUndefined();
  });
});

describe('an animated gift sticker is actually drawn', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  test('a webm gift sticker is drawn by a <video>, not an <img>', async () => {
    const msg = giftWebPageMsg(starGift({ sticker: animatedStickerDoc(940) }));
    const root = await mount(msg, { documentUrl: 'blob:gift-940', documentSource: 'memory' });
    expect(root.querySelector('.tgui-gift-card__video')).not.toBeNull();
    expect(root.querySelector('img')).toBeNull();
  });

  test('the animation loops and stays silent, as a chat sticker must', async () => {
    const root = await mount(giftWebPageMsg(starGift({ sticker: animatedStickerDoc(941) })), {
      documentUrl: 'blob:gift-941',
    });
    const video = root.querySelector('video') as HTMLVideoElement;
    expect(video.hasAttribute('loop')).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.getAttribute('src')).toBe('blob:gift-941');
  });

  test('a still webp gift sticker is still drawn as an image', async () => {
    const root = await mount(giftWebPageMsg(starGift()), { documentUrl: 'blob:gift-942' });
    expect(root.querySelector('.tgui-gift-card__img')).not.toBeNull();
    expect(root.querySelector('video')).toBeNull();
  });

  test('an animated sticker that arrives without bytes falls back to its thumbnail', async () => {
    const doc = animatedStickerDoc(943);
    doc.thumbs = [{
      _: 'photoSize', type: 's', w: 128, h: 128,
      url: 'blob:gift-thumb-943', photo: { _: 'photo', id: 777, sizes: [] },
    }];
    const root = await mount(giftWebPageMsg(starGift({ sticker: doc })));
    const img = root.querySelector('.tgui-gift-card__img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('blob:gift-thumb-943');
  });

  test('an animated gift in the service row is drawn too', async () => {
    const root = await mount(giftMsg({ _: 'messageActionGiftCode', gift: { sticker: animatedStickerDoc(944) } }), {
      documentUrl: 'blob:gift-944',
    });

    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(root.querySelector('video')).not.toBeNull();
  });
});

describe('a gift whose sticker is only a reference still shows the gift', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  function pagePhotoMsg(sticker: any): any {
    const msg = giftWebPageMsg(starGift({ sticker }));
    msg.media.webpage.photo = {
      _: 'photo',
      id: 4242,
      sizes: [{ _: 'photoSize', type: 'm', w: 320, h: 320, url: 'blob:gift-art-4242' }],
    };
    return msg;
  }

  test('a documentEmpty sticker falls back to the artwork on the gift page', async () => {
    const root = await mount(pagePhotoMsg(emptyRefSticker(5150)));
    const img = root.querySelector('.tgui-gift-card__img') as HTMLImageElement;

    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('blob:gift-art-4242');
    expect(root.querySelector('.tgui-gift-card__placeholder')).toBeNull();
  });

  test('the page photo is fetched when the gift page has none yet', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };
    const msg = pagePhotoMsg(emptyRefSticker(5151));
    msg.media.webpage.photo = { _: 'photo', id: 4243, sizes: [{ _: 'photoSize', type: 'm', w: 320, h: 320 }] };

    try {
      await mount(msg);
      const photo = requested.find((e: any) => e?.type === 'tg-download-photo');
      expect(photo).toBeDefined();
      expect(String(photo.detail.photo.id)).toBe('4243');
      expect(String(photo.detail.sizeType)).toBe('m');
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('a documentEmpty sticker is never asked to download', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };

    try {
      await mount(pagePhotoMsg(emptyRefSticker(5152)));
      const doc = requested.find((e: any) => e?.type === 'tg-download-document');

      expect(doc).toBeUndefined();
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('a real sticker document still wins over the page photo', async () => {
    const msg = pagePhotoMsg(animatedStickerDoc(5153));
    const root = await mount(msg, { documentUrl: 'blob:gift-sticker-5153' });
    expect(root.querySelector('video')).not.toBeNull();
    expect(root.querySelector('.tgui-gift-card__img')).toBeNull();
  });

  test('the artwork reports where its bytes came from', async () => {
    const root = await mount(pagePhotoMsg(emptyRefSticker(5154)), { photoSource: 'persisted' });
    const dot = root.querySelector('.tgui-gift-card .tgui-media-source-badge--dot') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain('tgui-media-source-badge--db');
  });

  test('a gift with neither a sticker nor a page photo keeps the placeholder', async () => {
    const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5155) }));
    const root = await mount(msg);

    expect(root.querySelector('.tgui-gift-card__placeholder')).not.toBeNull();
    expect(text(root)).toContain('Plush Pepe');
  });
});

describe('a gift card is drawn the way Telegram draws one', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  async function mountedCard(sticker: any, extra: Record<string, any> = {}) {
    const msg = giftWebPageMsg(starGift({ sticker }));
    msg.media.webpage.photo = {
      _: 'photo', id: 4242,
      sizes: [{ _: 'photoSize', type: 'm', w: 640, h: 640, url: 'blob:gift-art-4242' }],
    };
    return mount(msg, extra);
  }

  test('the card names the gift and then shows the art under it', async () => {
    const root = await mountedCard(emptyRefSticker(5150));
    const card = root.querySelector('.tgui-gift-card') as HTMLElement;
    const children = Array.from(card.children).map((c) => c.className);

    expect(children[0]).toContain('tgui-gift-card__accent');
    expect(children[1]).toContain('tgui-gift-card__head');
    expect(children[2]).toContain('tgui-gift-card__media');
    expect((root.querySelector('.tgui-gift-card__site') as HTMLElement).textContent).toBe('Telegram');
    expect((root.querySelector('.tgui-gift-card__title') as HTMLElement).textContent).toBe('Plush Pepe');
  });

  test('the artwork fills the card rather than sitting beside the title', async () => {
    const root = await mountedCard(emptyRefSticker(5151));

    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    const img = media.querySelector('img') as HTMLImageElement;
    expect(media.contains(img)).toBe(true);
    expect(img.getAttribute('src')).toBe('blob:gift-art-4242');
  });

  test('a separator and a single accent action close the card', async () => {
    const root = await mountedCard(emptyRefSticker(5152));
    const action = root.querySelector('.tgui-gift-card__action') as HTMLButtonElement;
    expect(action).not.toBeNull();
    expect(action.tagName).toBe('BUTTON');
    expect(action.textContent).toBe('Show gift');
  });

  test('a gift with no page keeps the title and the art, just without the action', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: starGift() }), {
      documentUrl: 'blob:gift-5153',
    });
    expect(root.querySelector('.tgui-gift-card__title')).not.toBeNull();

    expect(root.querySelector('.tgui-gift-card__action')).toBeNull();
  });
});

describe('an undownloadable sticker is resolved to one that can be downloaded', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('the slug is taken from the gift page url', () => {
    expect(giftStickerSlug(giftWebPageMsg(starGift()))).toBe('PlushPepe-2050');
    expect(giftStickerSlug({ media: { webpage: { url: 'https://example.com/x' } } })).toBe('');
  });

  test('a documentEmpty sticker asks to be resolved by slug, with both ids', () => {
    const resolution = giftStickerResolution(giftWebPageMsg(starGift()), starGift({ id: 5150, sticker: emptyRefSticker(777) }));

    expect(resolution).toEqual({ slug: 'PlushPepe-2050', giftId: '5150', documentId: '777' });
  });

  test('a sticker that can already be downloaded is left alone', () => {
    expect(giftStickerResolution(giftWebPageMsg(starGift()), starGift())).toBeNull();
  });

  test('the card asks for the real sticker once it is on screen', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };
    const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5154) }));
    msg.media.webpage.photo = { _: 'photo', id: 4243, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art' }] };

    try {
      await mount(msg);
      const ask = requested.find((e: any) => e?.type === 'tg-fetch-gift-sticker');
      expect(ask).toBeDefined();
      expect(ask.detail.slug).toBe('PlushPepe-2050');
      expect(String(ask.detail.messageId)).toBe('82');
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('a downloadable sticker never triggers the resolution', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };

    try {
      await mount(giftWebPageMsg(starGift()), { documentUrl: 'blob:gift-5155' });
      expect(requested.find((e: any) => e?.type === 'tg-fetch-gift-sticker')).toBeUndefined();
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });
});

describe('Show gift opens the collectible sheet', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  function rowTexts(sheet: HTMLElement): Array<[string, string]> {
    return Array.from(sheet.querySelectorAll('.tgui-gift-detail__row')).map((r) => [
      (r.querySelector('.tgui-gift-detail__label') as HTMLElement).textContent || '',
      (r.querySelector('.tgui-gift-detail__value-text') as HTMLElement).textContent || '',
    ]);
  }

  test('the sheet is laid out the way Telegram lays it out', async () => {
    const sheet = await openSheet();
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelector('.tgui-gift-detail__hero')).not.toBeNull();
    expect(sheet!.querySelector('.tgui-gift-detail__art')).not.toBeNull();

    expect(sheet!.querySelector('.tgui-gift-detail__hero-text .tgui-gift-detail__title')!.textContent).toContain('Plush Pepe');
    expect(sheet!.querySelector('.tgui-gift-detail__table')).not.toBeNull();
    expect((sheet!.querySelector('.tgui-gift-detail__ok') as HTMLButtonElement).textContent).toBe('OK');
  });

  test('the hero wears the colours the gift carries', async () => {
    const sheet = await openSheet();
    const hero = sheet!.querySelector('.tgui-gift-detail__hero') as HTMLElement;
    const style = hero.getAttribute('style') || '';

    expect(style).toMatch(/--gift-edge-color/);
    expect(style).toMatch(/--gift-center-color/);
    expect(hero.querySelector('.tgui-gift-backdrop__halo')).not.toBeNull();
    expect(hero.querySelector('canvas.tgui-gift-backdrop__motif')).not.toBeNull();
  });

  test('the sheet asks the server for the full collectible by slug', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };
    try {
      await openSheet();
      const ask = requested.find((e: any) => e?.type === 'tg-fetch-gift-details');
      expect(ask).toBeDefined();
      expect(ask.detail.slug).toBe('PlushPepe-2050');
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('model, pattern and backdrop appear with their rarity as a pill', async () => {
    const sheet = await openSheet();

    window.dispatchEvent(new CustomEvent('tg-gift-details', {
      detail: {
        slug: 'PlushPepe-2050',
        gift: {
          ...starGift(),
          attributes: [
            { _: 'starGiftAttributeModel', name: 'Hell Rise', rarity: { permille: 20 } },
            { _: 'starGiftAttributePattern', name: 'Jewel', rarity: { permille: 6 } },
            { _: 'starGiftAttributeBackdrop', name: 'Light Olive', rarity: { permille: 15 } },
          ],
        },
      },
    }));
    await wait(80);

    const sheet2 = document.body.querySelector('.tgui-gift-detail') as HTMLElement;
    const rows = rowTexts(sheet2);
    expect(rows).toContainEqual(['Model', 'Hell Rise']);
    expect(rows).toContainEqual(['Pattern', 'Jewel']);
    expect(rows).toContainEqual(['Backdrop', 'Light Olive']);

    const pills = Array.from(sheet2.querySelectorAll('.tgui-gift-detail__pill')).map((p) => p.textContent);
    expect(pills).toEqual(['2%', '0.6%', '1.5%']);
  });

  test('the model name sits under the title as the subtitle', async () => {
    await openSheet();
    window.dispatchEvent(new CustomEvent('tg-gift-details', {
      detail: {
        slug: 'PlushPepe-2050',
        gift: { ...starGift(), attributes: [{ _: 'starGiftAttributeModel', name: 'Hell Rise' }] },
      },
    }));
    await wait(80);
    const sub = document.body.querySelector('.tgui-gift-detail__subtitle') as HTMLElement;
    expect(sub.textContent).toBe('Hell Rise');
  });

  test('a row the server did not fill is not rendered', async () => {
    const sheet = await openSheet();
    const labels = rowTexts(sheet).map((r) => r[0]);

    expect(labels).not.toContain('Owner');
    expect(labels).not.toContain('Pattern');
    expect(labels).toContain('Price');
  });

  test('a sold out gift says so in its own row', async () => {
    const sheet = await openSheet({ sold_out: true });
    expect(rowTexts(sheet)).toContainEqual(['Edition', 'Sold out']);
  });

  test('OK takes the sheet off the page', async () => {
    const sheet = await openSheet();
    (sheet!.querySelector('.tgui-gift-detail__ok') as HTMLButtonElement).click();
    await wait();
    expect(document.body.querySelector('.tgui-gift-detail')).toBeNull();
  });

  test('a gift without a page has no action to press', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: starGift() }), { documentUrl: 'blob:x' });
    expect(root.querySelector('.tgui-gift-card__action')).toBeNull();
  });
});

describe('an animated gift starts playing without waiting for a click', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('playback is driven explicitly, not by toggling the autoplay attribute', async () => {
    const calls: string[] = [];
    const proto: any = (globalThis as any).HTMLVideoElement?.prototype;
    const origPlay = proto?.play;
    const origPause = proto?.pause;
    proto.play = function patchedPlay() { calls.push('play'); return Promise.resolve(); };
    proto.pause = function patchedPause() { calls.push('pause'); };

    try {
      const root = await mount(giftWebPageMsg(starGift({ sticker: animatedStickerDoc(5170) })), {
        documentUrl: 'blob:gift-5170',
      });
      const video = root.querySelector('video') as HTMLVideoElement;
      expect(video).not.toBeNull();

      expect(video.hasAttribute('autoplay')).toBe(false);
      expect(calls).toContain('play');
    } finally {
      if (origPlay) proto.play = origPlay;
      if (origPause) proto.pause = origPause;
    }
  });

  test('preload is eager so the first frame is not an empty box', async () => {
    const root = await mount(giftWebPageMsg(starGift({ sticker: animatedStickerDoc(5171) })), {
      documentUrl: 'blob:gift-5171',
    });
    const video = root.querySelector('video') as HTMLVideoElement;

    expect(video.getAttribute('preload')).toBe('auto');
  });
});

describe('a gift in the service row animates too', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('its animation is driven explicitly as well', async () => {
    const calls: string[] = [];
    const proto: any = (globalThis as any).HTMLVideoElement?.prototype;
    const origPlay = proto?.play;
    const origPause = proto?.pause;
    proto.play = function patchedPlay() { calls.push('play'); return Promise.resolve(); };
    proto.pause = function patchedPause() { calls.push('pause'); };

    try {
      const root = await mount(giftMsg({ _: 'messageActionGiftCode', gift: { sticker: animatedStickerDoc(5180) } }), {
        documentUrl: 'blob:gift-5180',
      });
      const video = root.querySelector('video') as HTMLVideoElement;
      expect(video).not.toBeNull();
      expect(video.hasAttribute('autoplay')).toBe(false);
      expect(calls).toContain('play');
    } finally {
      if (origPlay) proto.play = origPlay;
      if (origPause) proto.pause = origPause;
    }
  });
});

describe('a gift whose format is only known after resolving it', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  function tgsDoc(id: number): any {
    return {
      _: 'document', id, mime_type: 'application/x-tgsticker', size: 900,
      file_reference: new Uint8Array([7, 8, 9]),
      attributes: [{ _: 'documentAttributeSticker' }],
    };
  }

  test('the renderer is chosen from the resolved document, not from the message', () => {
    expect(giftVisualKind({ _: 'documentEmpty', id: 1 })).toBe('unknown');
    expect(giftVisualKind(tgsDoc(2))).toBe('tgs');
    expect(giftVisualKind(animatedStickerDoc(3))).toBe('video');
    expect(giftVisualKind(stickerDoc(4))).toBe('img');
  });

  test('an unresolved gift is not mistaken for a still image', () => {
    expect(giftVisualKind(null)).toBe('unknown');
    expect(giftVisualKind(undefined)).toBe('unknown');
  });

  test('the card learns the real document and asks for its bytes', async () => {
    const requested: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => { requested.push(e); return orig.call(window, e); };
    const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5190) }));
    msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art' }] };

    try {
      const root = await mount(msg);

      expect(requested.filter((e: any) => e?.type === 'tg-download-document')).toHaveLength(0);

      window.dispatchEvent(new CustomEvent('tg-gift-sticker', {
        detail: { messageId: msg.id, document: tgsDoc(5190) },
      }));
      await wait(80);

      const downloads = requested.filter((e: any) => e?.type === 'tg-download-document');
      expect(downloads.length).toBeGreaterThan(0);

      const sent = downloads[downloads.length - 1].detail.document;
      expect(String(sent.id)).toBe('5190');
      expect(sent.mime_type).toBe('application/x-tgsticker');
      expect(root.querySelector('.tgui-gift-card')).not.toBeNull();
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });

  test('a resolved webm gift is drawn by a <video>', async () => {
    const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5191) }));
    const root = await mount(msg, { documentUrl: 'blob:webm-5191' });
    window.dispatchEvent(new CustomEvent('tg-gift-sticker', {
      detail: { messageId: msg.id, document: animatedStickerDoc(5191) },
    }));
    await wait(80);
    expect(root.querySelector('video')).not.toBeNull();
  });

  test('a resolved still gift is drawn as an image', async () => {
    const msg = giftWebPageMsg(starGift({ sticker: emptyRefSticker(5192) }));
    const root = await mount(msg, { documentUrl: 'blob:webp-5192' });
    window.dispatchEvent(new CustomEvent('tg-gift-sticker', {
      detail: { messageId: msg.id, document: stickerDoc(5192) },
    }));
    await wait(80);
    expect(root.querySelector('img')).not.toBeNull();
    expect(root.querySelector('video')).toBeNull();
  });

  test('the service row learns the resolved document too', async () => {
    const msg = giftMsg({ _: 'messageActionGiftCode', gift: { sticker: emptyRefSticker(5193) } });
    const root = await mount(msg, { documentUrl: 'blob:webm-5193' });
    window.dispatchEvent(new CustomEvent('tg-gift-sticker', {
      detail: { messageId: msg.id, document: animatedStickerDoc(5193) },
    }));
    await wait(80);
    expect(root.querySelector('.tgui-service-msg')).not.toBeNull();
    expect(root.querySelector('video')).not.toBeNull();
  });
});

describe('the resolution survives the server answering with an empty reference', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('the card keeps asking even if a documentEmpty comes back', async () => {
    const asked: Array<any> = [];
    const orig = window.dispatchEvent;
    (window as any).dispatchEvent = (e: any) => {
      if (e?.type === 'tg-fetch-gift-sticker') asked.push(e.detail);
      return orig.call(window, e);
    };
    const msg = giftWebPageMsg(starGift({ id: 5150, sticker: emptyRefSticker(777) }));
    msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art' }] };

    try {
      await mount(msg);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked[0].giftId).toBe('5150');
      expect(asked[0].documentId).toBe('777');
    } finally {
      (window as any).dispatchEvent = orig;
    }
  });
});

describe('a collectible carries its artwork in the model attribute', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', { enabled: true, level: 'debug' }));
  afterEach(() => { document.body.innerHTML = ''; });

  function tgsDoc(id: number): any {
    return {
      _: 'document', id, mime_type: 'application/x-tgsticker', size: 900,
      file_reference: new Uint8Array([7, 8, 9]),
      attributes: [{ _: 'documentAttributeSticker' }],
    };
  }

  function collectibleGift(docId: number): any {
    return {
      ...starGift({ sticker: { _: 'documentEmpty', id: docId } }),
      attributes: [
        { _: 'starGiftAttributeModel', name: 'Yellow Hug', document: tgsDoc(6001), rarity: { permille: 30 } },
        { _: 'starGiftAttributePattern', name: 'Lovely Kiss', document: animatedStickerDoc(6002), rarity: { permille: 5 } },
        { _: 'starGiftAttributeBackdrop', name: 'Indigo Dye', center_color: 0x334455, rarity: { permille: 20 } },
      ],
    };
  }

  test('the artwork is read from the model attribute, not from sticker', () => {
    const doc = giftArtworkDocument(collectibleGift(777));
    expect(doc?.id).toBe(6001);
    expect(doc?.mime_type).toBe('application/x-tgsticker');
    expect(giftVisualKind(doc)).toBe('tgs');
  });

  test('the model is preferred over the pattern', () => {
    const doc = giftArtworkDocument(collectibleGift(778));
    expect(doc?.id).not.toBe(6002);
  });

  test('a plain gift still uses its own sticker', () => {
    expect(giftArtworkDocument(starGift()).id).toBe(5150);
  });

  test('a collectible needs no lookup at all', () => {
    expect(giftStickerResolution(giftWebPageMsg(collectibleGift(779)), collectibleGift(779))).toBeNull();
  });

  test('the card uses the model artwork, not the page photo', async () => {
    const msg = giftWebPageMsg(collectibleGift(780));
    msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:page-photo' }] };
    const root = await mount(msg, { documentUrl: 'blob:tgs-6001' });

    const img = root.querySelector('.tgui-gift-card__img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('blob:tgs-6001');
    expect(img!.getAttribute('src')).not.toBe('blob:page-photo');
  });

  test('a collectible with neither sticker nor attributes has no artwork', () => {
    const bare = { ...starGift({ sticker: { _: 'documentEmpty', id: 9 } }), attributes: [] };

    expect(giftArtworkDocument(bare)).toBeNull();
  });
});

describe('a gift wears its own colours', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  const backdrop = { _: 'starGiftAttributeBackdrop', name: 'Light Olive', center_color: 0x9aa03c, edge_color: 0x6f7a24, rarity: { permille: 20 } };

  test('a collectible takes its colours from the backdrop attribute', () => {
    const collectible = { ...starGift(), attributes: [backdrop] };
    const { giftBackgroundColors } = require('../dist/components/gift-shared.js');
    expect(giftBackgroundColors(collectible)).toEqual({ center: '#9aa03c', edge: '#6f7a24' });
  });

  test('the centre is a halo above the field, not the far end of a gradient', () => {
    const { giftBackgroundColors } = require('../dist/components/gift-shared.js');
    const both = { ...starGift(), attributes: [backdrop] };
    expect(giftBackgroundColors(both)).toEqual({ center: '#9aa03c', edge: '#6f7a24' });

    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const halo = /\.tgui-gift-backdrop__halo\s*\{([^}]*)\}/.exec(css);
    expect(halo).not.toBeNull();
    expect(halo![1]).toMatch(/radial-gradient/);
    expect(halo![1]).toMatch(/var\(--gift-center-color/);
    expect(halo![1]).toMatch(/left:\s*50%/);
    expect(halo![1]).toMatch(/translateX\(-50%\)/);

    const small = /\.tgui-gift-backdrop__halo_small\s*\{([^}]*)\}/.exec(css);
    expect(small![1]).toMatch(/width:\s*200px/);
    expect(small![1]).toMatch(/height:\s*200px/);
  });

  test('a gift with no colours of its own falls back to Telegram grey', () => {
    const { giftBackgroundColors, giftBackdropSource } = require('../dist/components/gift-shared.js');
    const bare = { ...starGift(), background: undefined, attributes: [] };
    expect(giftBackgroundColors(bare)).toEqual({ center: null, edge: null });
    expect(giftBackdropSource(bare)).toBe('none');
  });

  test('the sheet hero is painted with the gift colours', async () => {
    const msg = giftWebPageMsg({ ...starGift(), attributes: [backdrop] });
    const root = await mount(msg);
    (root.querySelector('.tgui-gift-card__action') as HTMLButtonElement).click();
    await wait();
    const hero = document.body.querySelector('.tgui-gift-detail__hero') as HTMLElement;
    const style = hero.getAttribute('style') || '';
    expect(style).toMatch(/--gift-edge-color:#6f7a24/);
    expect(style).toMatch(/--gift-center-color:#9aa03c/);
  });
});

describe('the sheet reads the collectible, not just the message', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  const FULL_COLLECTIBLE = {
    ...starGift(),
    owner_name: 'Gift Relayer VIRUS',
    availability_issued: 1950,
    availability_total: 1973,
    value_amount: 152664,
    value_currency: 'TON',
    attributes: [
      { _: 'starGiftAttributeModel', name: 'Yellow Hug', rarity: { permille: 30 } },
      { _: 'starGiftAttributePattern', name: 'Lovely Kiss', rarity: { permille: 5 } },
      { _: 'starGiftAttributeBackdrop', name: 'Indigo Dye', center_color: 0x2b4a7a, edge_color: 0x16233a, rarity: { permille: 20 } },
    ],
  };

  async function openFullSheet() {
    const msg = giftWebPageMsg(FULL_COLLECTIBLE);
    msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art' }] };
    const root = await mount(msg);
    (root.querySelector('.tgui-gift-card__action') as HTMLButtonElement).click();
    await wait();
    window.dispatchEvent(new CustomEvent('tg-gift-details', {
      detail: { slug: 'PlushPepe-2050', gift: FULL_COLLECTIBLE, value: { value: 152664, currency: 'TON' } },
    }));
    await wait(80);
    return document.body.querySelector('.tgui-gift-detail') as HTMLElement;
  }

  function rows(sheet: HTMLElement): Array<[string, string]> {
    return Array.from(sheet.querySelectorAll('.tgui-gift-detail__row')).map((r) => [
      (r.querySelector('.tgui-gift-detail__label') as HTMLElement).textContent || '',
      (r.querySelector('.tgui-gift-detail__value-text') as HTMLElement).textContent || '',
    ]);
  }

  test('the owner row is filled from the collectible', async () => {
    const sheet = await openFullSheet();

    expect(rows(sheet)).toContainEqual(['Owner', 'Gift Relayer VIRUS']);
  });

  test('supply is issued of total, not a listing count', async () => {
    const sheet = await openFullSheet();
    expect(rows(sheet)).toContainEqual(['Supply', '1,950 / 1,973']);
  });

  test('the value carries its currency', async () => {
    const sheet = await openFullSheet();
    expect(rows(sheet)).toContainEqual(['Value', '~152,664 TON']);
  });

  test('the hero is painted with the backdrop colours', async () => {
    const sheet = await openFullSheet();
    const hero = sheet.querySelector('.tgui-gift-detail__hero') as HTMLElement;
    const style = hero.getAttribute('style') || '';
    expect(style).toMatch(/--gift-edge-color/);
    expect(style).toMatch(/--gift-center-color/);
  });

  test('the name sits under the artwork in the header column, not over it', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

    const hero = /\.tgui-gift-detail__hero\s*\{([^}]*)\}/.exec(css);
    expect(hero).not.toBeNull();
    expect(hero![1]).toMatch(/flex-direction:\s*column/);
    expect(hero![1]).not.toMatch(/aspect-ratio/);
    const copy = /\.tgui-gift-detail__hero-text\s*\{([^}]*)\}/.exec(css);
    expect(copy).not.toBeNull();
    expect(copy![1]).not.toMatch(/position:\s*absolute/);

    expect(copy![1]).toMatch(/align-self:\s*stretch/);
    const art = /\.tgui-gift-detail__art\s*\{([^}]*)\}/.exec(css);
    expect(art).not.toBeNull();

    const width = /width:\s*(\d+)px/.exec(art![1]);
    expect(width).not.toBeNull();
    expect(Number(width![1])).toBe(120);
  });

  test('the hero is given the motif url and reports its state', async () => {
    await openSheet({
      attributes: [
        { _: 'starGiftAttributeModel', name: 'Hell Rise', document: { _: 'document', id: 6061, mime_type: 'application/x-tgsticker', size: 900, attributes: [{ _: 'documentAttributeSticker' }] }, rarity: { permille: 20 } },
        { _: 'starGiftAttributePattern', name: 'Lovely Kiss', document: { _: 'document', id: 6060, mime_type: 'image/png' }, rarity: { permille: 6 } },
      ],
    });
    await wait(80);
    const hero = document.body.querySelector('.tgui-gift-detail__hero') as HTMLElement;
    expect(hero).not.toBeNull();

    expect(hero.getAttribute('data-motif')).toBeTruthy();
    expect(hero.getAttribute('data-motif')).not.toBe('none');
  });

  test('a gift with no motif says so rather than pretending', async () => {
    const sheet = await openSheet();
    await wait(40);
    const hero = document.body.querySelector('.tgui-gift-detail__hero') as HTMLElement;
    expect(hero?.getAttribute('data-motif')).toBe('none');
  });
});

describe('the card is what Telegram puts in the chat', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  const COLLECTIBLE = {
    ...starGift(),
    title: 'Plush Pepe',
    num: 2050,
    attributes: [
      { _: 'starGiftAttributeBackdrop', name: 'Indigo Dye', center_color: 0x2b4a7a, edge_color: 0x16233a },
    ],
  };

  async function mountCollectible() {
    const msg = giftWebPageMsg(COLLECTIBLE);
    msg.message = 'Gift Relayer (VIRUS) has sent you a unique collectible gift...';
    msg.media.webpage.photo = { _: 'photo', id: 4242, sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:art' }] };
    return mount(msg);
  }

  test('the sentence explaining the gift is shown above the card', async () => {
    const root = await mountCollectible();

    expect(text(root)).toContain('has sent you a unique collectible gift');
    expect(root.querySelector('.tgui-gift-card')).not.toBeNull();
  });

  test('the title carries the collectible number', async () => {
    const msg = giftWebPageMsg({ ...COLLECTIBLE, num: undefined });
    const root = await mount(msg);
    (root.querySelector('.tgui-gift-card__action') as HTMLButtonElement).click();
    await wait();
    window.dispatchEvent(new CustomEvent('tg-gift-details', {
      detail: { slug: 'PlushPepe-2050', gift: COLLECTIBLE },
    }));
    await wait(80);

    expect(document.body.querySelector('.tgui-gift-card__title')!.textContent).toBe('Plush Pepe #2050');
  });

  test('a plain gift with no number keeps a bare title', async () => {
    const root = await mount(giftWebPageMsg(starGift()));
    expect((root.querySelector('.tgui-gift-card__title') as HTMLElement).textContent).toBe('Plush Pepe');
  });

  test('the artwork sits on the gift backdrop rather than replacing it', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const media = /\.tgui-gift-card__media\s*\{([^}]*)\}/.exec(css);
    expect(media).not.toBeNull();

    expect(media![1]).toMatch(/padding/);
    const img = /\.tgui-gift-card__img\s*,\s*\n?\.tgui-gift-card__video\s*\{([^}]*)\}/.exec(css);
    expect(img).not.toBeNull();
    expect(img![1]).toMatch(/object-fit:\s*contain/);
  });

  test('the separator above the action is inset', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const action = /\.tgui-gift-card__action\s*\{([^}]*)\}/.exec(css);
    expect(action).not.toBeNull();
    expect(action![1]).toMatch(/border-top/);

    expect(action![1]).toMatch(/margin:\s*8px var\(--gift-card-inset, 8px\) 0/);
    expect(action![1]).toMatch(/text-align:\s*center/);
  });
});

describe('a gift message is one bubble with one timestamp', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('the gift is a real MessageBubble, not a hand-built lookalike', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.message = 'Gift Relayer (VIRUS) has sent you a unique collectible gift...';
    const root = await mount(msg);

    const bubble = root.querySelector('.MessageBubble_gift') as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.classList.contains('MessageBubble')).toBe(true);
    expect(bubble.classList.contains('MessageBubble_in')).toBe(true);
  });

  test('the text and the card share that one bubble', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.message = 'Gift Relayer (VIRUS) has sent you a unique collectible gift...';
    const root = await mount(msg);

    const bubble = root.querySelector('.MessageBubble_gift') as HTMLElement;
    expect(bubble.querySelector('.MessageBubble')).toBeNull();
    expect(bubble.querySelector('.tgui-gift-card')).not.toBeNull();
    expect(bubble.querySelector('.MessageBubble__text')).not.toBeNull();
  });

  test('the card sits in the media slot, between the text and the time', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.message = 'has sent you a unique collectible gift...';
    const root = await mount(msg);

    const bubble = root.querySelector('.MessageBubble_gift') as HTMLElement;
    const order = Array.from(bubble.children).map((c) => c.className);
    expect(order[0]).toContain('MessageBubble__text');
    expect(order[1]).toContain('MessageBubble__media');
    expect(order[2]).toContain('MessageBubble__meta');
    expect((bubble.querySelector('.MessageBubble__media') as HTMLElement)
      .querySelector('.tgui-gift-card')).not.toBeNull();
  });

  test('the timestamp is the one MessageBubble renders', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.message = 'has sent you a unique collectible gift...';
    const root = await mount(msg);
    expect(root.querySelectorAll('.MessageBubble__time')).toHaveLength(1);
  });

  test('the message text is still rendered', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.message = 'has sent you a unique collectible gift...';
    const root = await mount(msg);
    expect(text(root)).toContain('has sent you a unique collectible gift');
  });

  test('a gift with no text still renders just the card', async () => {
    const root = await mount(giftWebPageMsg(starGift()));
    expect(root.querySelector('.tgui-gift-card')).not.toBeNull();
  });
});

describe('the gift field carries no invented motif', () => {
  test('no pattern is drawn on top of the gift colours', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const media = /\.tgui-gift-card__media\s*\{([^}]*)\}/.exec(css);
    expect(media).not.toBeNull();

    expect(media![1]).not.toMatch(/radial-gradient/);

    const layer = /\.tgui-gift-card__media::before\s*\{([^}]*)\}/.exec(css);
    if (layer) expect(layer[1]).toMatch(/radial-gradient/);
  });
});

describe('the collectible keeps the pattern Telegram sends with it', () => {
  test('the pattern document is read off the gift attribute', () => {
    const { giftPatternDocument } = require('../dist/components/gift-shared.js');
    const pattern = { _: 'document', id: 777, mime_type: 'image/png' };
    const gift = {
      attributes: [
        { _: 'starGiftAttributeModel', document: { _: 'document', id: 111 } },
        { _: 'starGiftAttributePattern', document: pattern },
      ],
    };
    expect(giftPatternDocument(gift)).toBe(pattern);
    expect(giftPatternDocument({ attributes: [] })).toBeNull();
    expect(giftPatternDocument({
      attributes: [{ _: 'starGiftAttributePattern', document: { _: 'documentEmpty' } }],
    })).toBeNull();
    expect(giftPatternDocument({ attributes: [{ _: 'starGiftAttributePattern' }] })).toBeNull();
    expect(giftPatternDocument(null)).toBeNull();
  });

  test('the pattern is requested under a synthetic key so the art slot is untouched', async () => {
    const events: Array<{ type: string; detail: any }> = [];
    const onReq = (e: Event) => events.push({ type: 'req', detail: (e as CustomEvent).detail });
    window.addEventListener('tg-download-document', onReq);
    try {
      const gift = starGift({
        attributes: [{ _: 'starGiftAttributePattern', document: { _: 'document', id: 909, mime_type: 'image/png' } }],
      });
      await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
      const patternReq = events.find((e) => String(e.detail?.messageId || '').startsWith('gift-pattern-'));
      expect(patternReq).toBeDefined();
      expect(String(patternReq!.detail.messageId)).toBe('gift-pattern-909');
    } finally {
      window.removeEventListener('tg-download-document', onReq);
    }
  });
});

describe('the card is a panel on the themed message', () => {
  test('the card has its own surface, the way Telegram insets it', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const card = /\.tgui-gift-card\s*\{([^}]*)\}/.exec(css);
    expect(card).not.toBeNull();

    expect(card![1]).toMatch(/background:\s*var\(--gift-card-bg\)/);
    expect(card![1]).toMatch(/border-radius:/);
    expect(css).toMatch(/--gift-card-bg:\s*#[0-9a-f]{3,8}/i);
  });

  test('the message surface comes from the theme, not from a gift override', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const bubble = /\.MessageBubble_gift\s*\{([^}]*)\}/.exec(css);
    expect(bubble).not.toBeNull();

    expect(bubble![1]).not.toMatch(/background:\s*var\(--gift-msg-bg\)/);
    expect(css).toMatch(/--bubble-in:\s*(#fff|#ffffff|var)/i);
  });

  test('the variant only sets padding and drops the shadow', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const bubble = /\.MessageBubble_gift\s*\{([^}]*)\}/.exec(css)![1];
    expect(bubble).toMatch(/box-shadow:\s*none/);
    expect(bubble).toMatch(/padding:\s*0/);

    expect(bubble).not.toMatch(/flex-direction/);
    expect(bubble).not.toMatch(/border-radius/);
    expect(bubble).not.toMatch(/display:\s*flex/);
  });

  test('the three parts are laid out by flow, not by an ordering hack', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

    expect(css).not.toMatch(/\.MessageBubble_gift[^}]*order:/);
  });
});

describe('the backdrop carries the gift colours and nothing else', () => {
  const { giftBackgroundColors, giftPatternColor } = require('../dist/components/gift-shared.js');
  const coloured = {
    attributes: [{ _: 'starGiftAttributeBackdrop', center_color: 0x112233, edge_color: 0x445566 }],
  };

  test('the edge colour is the field and the centre is kept apart for the halo', () => {
    const colors = giftBackgroundColors(coloured);

    expect(colors.edge).toBe('#445566');
    expect(colors.center).toBe('#112233');
  });

  test('a gift that brings no colours has none at all', () => {
    expect(giftBackgroundColors({ attributes: [] })).toEqual({ center: null, edge: null });
  });

  test('the pattern colour is read from the backdrop on its own', () => {
    expect(giftPatternColor(coloured)).toBeNull();
    expect(giftPatternColor({ attributes: [{ _: 'starGiftAttributeBackdrop', pattern_color: 0x778899 }] })).toBe('#778899');
  });
});

describe('the backdrop motif is never mistaken for the gift itself', () => {
  const { giftArtworkDocument } = require('../dist/components/gift-shared.js');

  test('a collectible with no model does not borrow the pattern as its artwork', () => {
    const pattern = { _: 'document', id: 6002, mime_type: 'application/x-tgsticker' };
    const gift = {
      sticker: { _: 'documentEmpty', id: 1 },
      attributes: [{ _: 'starGiftAttributePattern', document: pattern }],
    };

    expect(giftArtworkDocument(gift)).toBeNull();
  });

  test('the model still wins when both attributes carry a document', () => {
    const model = { _: 'document', id: 6001 };
    const gift = {
      sticker: { _: 'documentEmpty', id: 1 },
      attributes: [
        { _: 'starGiftAttributeModel', document: model },
        { _: 'starGiftAttributePattern', document: { _: 'document', id: 6002 } },
      ],
    };
    expect(giftArtworkDocument(gift)).toBe(model);
  });
});

describe('the backdrop spans the panel', () => {
  test('the artwork field is inset inside the card, not the full bleed', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const media = /\.tgui-gift-card__media\s*\{([^}]*)\}/.exec(css)!;

    expect(media[1]).toMatch(/margin:\s*0 4px/);
    expect(media[1]).toMatch(/border-radius:\s*16px/);
  });

  test('the motif is stamped, not tiled or stretched', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

    expect(css).not.toMatch(/\.tgui-gift-backdrop::before/);
    const motif = /\.tgui-gift-backdrop__motif\s*\{([^}]*)\}/.exec(css);
    expect(motif).not.toBeNull();
    expect(motif![1]).toMatch(/position:\s*absolute/);
    expect(motif![1]).toMatch(/left:\s*50%/);
    expect(motif![1]).toMatch(/translateX\(-50%\)/);
    expect(css).not.toMatch(/--gift-tile/);
    expect(css).not.toMatch(/mask-image/);
  });
});

describe('the motif reaches the backdrop once its bytes arrive', () => {
  test('the media field paints the pattern over the gift colours', async () => {
    const events: Array<{ type: string; detail: any }> = [];
    const seen = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });
    window.addEventListener('tg-download-document', seen);
    try {
      const gift = {
        ...starGift(),
        attributes: [
          { _: 'starGiftAttributePattern', document: { _: 'document', id: 909, mime_type: 'image/png' } },
          { _: 'starGiftAttributeBackdrop', name: 'Indigo', center_color: 0x112233, edge_color: 0x445566 },
        ],
      };
      const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
      const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

      const req = events.find((e) => e.type === 'tg-download-document');
      expect(req).toBeDefined();

      expect(media.getAttribute('style') || '').toContain('--gift-edge-color:#445566');
      expect(media.getAttribute('style') || '').not.toContain('url(');
      const canvas = media.querySelector('canvas.tgui-gift-backdrop__motif') as HTMLCanvasElement;
      expect(canvas).not.toBeNull();

      window.dispatchEvent(new CustomEvent('tg-emoji-url', {
        detail: { docId: '909', url: 'blob:motif', kind: 'sticker' },
      }));
      await wait(20);

      const after = root.querySelector('.tgui-gift-card__media') as HTMLElement;
      const afterCanvas = after.querySelector('canvas.tgui-gift-backdrop__motif') as HTMLCanvasElement;
      expect(afterCanvas).toBe(canvas);
      expect(after.getAttribute('style') || '').toContain('#112233');
    } finally {
      window.removeEventListener('tg-download-document', seen);
      document.body.innerHTML = '';
    }
  });
});

describe('the card keeps the bar Telegram draws down its edge', () => {
  test('the accent bar is on the card and spans its full height', async () => {
    const root = await mount(giftWebPageMsg(starGift()));
    const bar = root.querySelector('.tgui-gift-card__accent') as HTMLElement;

    expect(bar).not.toBeNull();

    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const rule = /\.tgui-gift-card__accent\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/top:\s*0/);
    expect(rule![1]).toMatch(/bottom:\s*0/);
    expect(rule![1]).toMatch(/left:\s*0/);
    expect(rule![1]).toMatch(/background:\s*var\(--gift-accent/);
  });
});

describe('an animated motif is not fetched as a document', () => {
  test('its bytes are skipped, because the still frame is used instead', async () => {
    const events: Array<{ type: string; detail: any }> = [];
    const seen = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });
    window.addEventListener('tg-download-document', seen);
    try {
      const gift = {
        ...starGift(),
        attributes: [{
          _: 'starGiftAttributePattern',
          document: { _: 'document', id: 707, mime_type: 'application/x-tgsticker' },
        }],
      };
      await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});

      const req = events.find((e) => e.type === 'tg-download-document'
        && String(e.detail?.messageId || '') === 'gift-pattern-707');
      expect(req).toBeUndefined();
    } finally {
      window.removeEventListener('tg-download-document', seen);
      document.body.innerHTML = '';
    }
  });

  test('an image motif is still requested', async () => {
    const events: Array<{ type: string; detail: any }> = [];
    const seen = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });
    window.addEventListener('tg-download-document', seen);
    try {
      const gift = {
        ...starGift(),
        attributes: [{
          _: 'starGiftAttributePattern',
          document: { _: 'document', id: 708, mime_type: 'image/png' },
        }],
      };
      await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
      const req = events.find((e) => String(e.detail?.messageId || '') === 'gift-pattern-708');
      expect(req).toBeDefined();
    } finally {
      window.removeEventListener('tg-download-document', seen);
      document.body.innerHTML = '';
    }
  });
});

describe('every gift card is the same size', () => {
  const css = () => require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

  test('the card has a fixed width instead of following the sentence above it', () => {
    const card = /\.tgui-gift-card\s*\{([^}]*)\}/.exec(css())![1];

    expect(card).toMatch(/width:\s*var\(--gift-card-width/);

    expect(card).not.toMatch(/(^|[;\s])width:\s*100%/);
  });

  test('the card still yields on a narrow chat', () => {
    const card = /\.tgui-gift-card\s*\{([^}]*)\}/.exec(css())![1];
    expect(card).toMatch(/max-width:\s*100%/);
  });

  test('the artwork field is tall enough to hold the motif canvas', () => {
    const media = /\.tgui-gift-card__media\s*\{([^}]*)\}/.exec(css())![1];

    expect(media).toMatch(/min-height:\s*184px/);
    expect(media).not.toMatch(/aspect-ratio/);
  });
});

describe('the gift bubble obeys the same width rule as any message', () => {
  test('a gift no longer reaches further across the chat than a text message', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const bubble = /\.MessageBubble_gift\s*\{([^}]*)\}/.exec(css)![1];

    expect(bubble).toMatch(/max-width:\s*min\(75%,/);
    expect(bubble).not.toMatch(/max-width:\s*100%/);
  });

  test('a short sentence does not stretch the card', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const bubble = /\.MessageBubble_gift\s*\{([^}]*)\}/.exec(css)![1];

    expect(bubble).toMatch(/--gift-card-width/);
  });
});

describe('the card and the sheet never disagree about the artwork', () => {
  test('a page photo standing in for the sticker is drawn as an image', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.media.webpage.photo = {
      _: 'photo', id: 5151,
      sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:page-photo' }],
    };
    const root = await mount(msg);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    const img = media.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('blob:page-photo');

    expect(media.querySelector('video')).toBeNull();
  });

  test('the sheet is handed the renderer the card used', () => {
    const src = require('node:fs').readFileSync(
      require.resolve('../src/components/gift-card.tsx'), 'utf8');
    expect(src).toMatch(/<GiftDetail[^>]*artKind=\{artKind\}/s);
    const detail = require('node:fs').readFileSync(
      require.resolve('../src/components/gift-detail.tsx'), 'utf8');

    expect(detail).toMatch(/const kind = artKind \|\|/);
  });
});

describe('the inline keyboard sits inside the card width', () => {
  test('the keyboard no longer bleeds past the bubble', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const kb = /\.MessageBubble_gift \.MessageBubble__kb\s*\{([^}]*)\}/.exec(css);
    expect(kb).not.toBeNull();

    expect(kb![1]).toMatch(/margin-left:\s*0/);
    expect(kb![1]).toMatch(/margin-right:\s*0/);
    expect(kb![1]).not.toMatch(/margin:\s*4px -11px/);
  });
});

describe('the artwork says where it came from', () => {
  test('a card drawing the page photo says so', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.media.webpage.photo = {
      _: 'photo', id: 5152,
      sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:page-photo-2' }],
    };
    const root = await mount(msg);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

    expect(media.getAttribute('data-art')).toBe('page-photo');
  });

  test('a card drawing sticker bytes says so', async () => {
    const root = await mount(giftWebPageMsg(starGift()), { documentUrl: 'blob:tgs-5153' });
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-art')).toBe('sticker');
  });

  test('a card with nothing to draw admits it', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.media.webpage.photo = { _: 'photo', id: 5154, sizes: [] };
    const root = await mount(msg);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-art')).toBe('none');
  });
});

describe('the sheet does not pick a renderer the card would not', () => {
  test('a resolved animated sticker does not hijack the page photo in the sheet', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.media.webpage.photo = {
      _: 'photo', id: 5155,
      sizes: [{ _: 'photoSize', type: 'm', w: 64, h: 64, url: 'blob:page-photo-3' }],
    };
    const root = await mount(msg, { documentUrl: 'blob:page-photo-3' });
    (root.querySelector('.tgui-gift-card__action') as HTMLButtonElement).click();
    await wait(60);

    const art = document.body.querySelector('.tgui-gift-detail__art') as HTMLElement;
    expect(art).not.toBeNull();

    expect(art.tagName).toBe('IMG');
    expect(art.getAttribute('src')).toBe('blob:page-photo-3');
  });
});

describe('the viewport hook is shared, not re-written per component', () => {
  const read = (rel: string) =>
    require('node:fs').readFileSync(require.resolve(rel), 'utf8');

  test('the card does not build its own observers', () => {
    const card = read('../src/components/gift-card.tsx');

    expect(card).not.toMatch(/new IntersectionObserver/);
    expect(card).toMatch(/useNearViewport\(/);
  });

  test('the link preview loads its photo through the same hook', () => {
    const preview = read('../src/components/link-preview.tsx');
    expect(preview).not.toMatch(/new IntersectionObserver/);
    expect(preview).toMatch(/useNearViewport\(/);
  });

  test('loading latches once and playback keeps tracking the viewport', () => {
    const hook = read('../src/components/use-near-viewport.ts');

    expect(hook).toMatch(/setVisible\(true\)/);
    expect(hook).toMatch(/observer\.disconnect\(\)/);
    expect(hook).toMatch(/observeVisibility\(node, playMargin/);
    expect(hook).toMatch(/rootMargin: startMargin \+ 'px'/);
  });
});

describe('a gift message inherits everything a text message has', () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../src/components/chat-area.tsx'), 'utf8');

  test('both gift branches pass the props the plain text bubble does', () => {
    const propsAfter = (needle: string): string[] => {
      const at = src.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('media={<GiftCard', at));
      return Array.from(body.matchAll(/(\w+)=\{/g)).map((m) => m[1]);
    };

    const actionBranch = propsAfter('<MessageBubble\n            className="MessageBubble_gift"');
    const pageBranch = propsAfter('<MessageBubble\n                className="MessageBubble_gift"');

    for (const prop of [
      'inactiveButtons', 'buttonNotice', 'reactions', 'reactionUrls', 'replyMarkup',
      'richMessage', 'richDocumentUrls', 'onOpenPhoto', 'onKbButton', 'onRichButton',
    ]) {
      expect(actionBranch).toContain(prop);
      expect(pageBranch).toContain(prop);
    }
  });

  test('the two gift branches stay in step with each other', () => {
    const propsAfter = (needle: string): string[] => {
      const at = src.indexOf(needle);
      const body = src.slice(at, src.indexOf('media={<GiftCard', at));
      return Array.from(body.matchAll(/(\w+)=\{/g)).map((m) => m[1]).sort();
    };

    expect(propsAfter('<MessageBubble\n            className="MessageBubble_gift"'))
      .toEqual(propsAfter('<MessageBubble\n                className="MessageBubble_gift"'));
  });
});

describe('the card reports what it drew, in the DOM itself', () => {
  test('the motif state is on the element, not only in a log', async () => {
    const msg = giftWebPageMsg(starGift());
    msg.media.webpage.photo = { _: 'photo', id: 5156, sizes: [] };
    const root = await mount(msg);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

    expect(media.getAttribute('data-motif')).toBeTruthy();
    expect(media.getAttribute('data-motif-doc')).toBe('none');
  });

  test('a gift with a pattern document says which one', async () => {
    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: { _: 'document', id: 6161, mime_type: 'image/png' },
      }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-motif-doc')).toBe('6161');
    expect(media.getAttribute('data-motif')).toBe('pending');
  });

  test('the artwork is 120px on the backdrop, as in the bubble', () => {
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    const rule = /\.tgui-gift-card__img\s*,\s*\n?\.tgui-gift-card__video\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();

    expect(rule![1]).toMatch(/width:\s*120px/);
    expect(rule![1]).toMatch(/height:\s*120px/);

    expect(css).not.toMatch(/\.tgui-gift-card__media \.tgui-animated-sticker\s*\{[^}]*width:\s*100%/);
  });
});

describe('an animated motif is painted from its own still frame', () => {
  test('a webm motif with a thumbnail paints that thumbnail', async () => {
    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7001, mime_type: 'video/webm', size: 4000,
          thumbs: [{ _: 'photoSize', type: 'm', w: 120, h: 120, url: 'blob:motif-still' }],
        },
      }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    await wait(30);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-motif')).toBe('ready');

    expect(media.getAttribute('data-motif-src')).toBe('blob:motif-still');
    expect(media.querySelector('canvas.tgui-gift-backdrop__motif')).not.toBeNull();
  });

  test('a lottie motif uses video_thumbs when there are no thumbs', async () => {
    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7002, mime_type: 'application/x-tgsticker', size: 4000,
          video_thumbs: [{ _: 'videoSize', type: 'v', w: 100, h: 100, url: 'blob:lottie-still' }],
        },
      }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    await wait(30);
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-motif')).toBe('ready');
    expect(media.getAttribute('data-motif-src')).toBe('blob:lottie-still');
    expect(media.querySelector('canvas.tgui-gift-backdrop__motif')).not.toBeNull();
  });

  test('an animated motif with no still yet asks for one', async () => {
    const reqs: any[] = [];
    const onReq = (e: Event) => reqs.push((e as CustomEvent).detail);
    window.addEventListener('tg-download-document-thumb', onReq);
    try {
      const gift = {
        ...starGift(),
        attributes: [{
          _: 'starGiftAttributePattern',
          document: { _: 'document', id: 7003, mime_type: 'video/webm', size: 4000, video_thumbs: [{ _: 'videoSize', type: 'v', w: 100, h: 100 }] },
        }],
      };
      const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
      expect(reqs.some((d) => String(d?.messageId || '').startsWith('gift-pattern-'))).toBe(true);

      const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
      expect(media.getAttribute('data-motif')).toBe('animated');
    } finally {
      window.removeEventListener('tg-download-document-thumb', onReq);
    }
  });

  test('a still motif is still downloaded as a document', async () => {
    const reqs: any[] = [];
    const onReq = (e: Event) => reqs.push((e as CustomEvent).detail);
    window.addEventListener('tg-download-document', onReq);
    try {
      const gift = {
        ...starGift(),
        attributes: [{
          _: 'starGiftAttributePattern',
          document: { _: 'document', id: 7004, mime_type: 'image/png' },
        }],
      };
      await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
      expect(reqs.some((d) => String(d?.messageId || '') === 'gift-pattern-7004')).toBe(true);
    } finally {
      window.removeEventListener('tg-download-document', onReq);
    }
  });
});

describe('the card says which backdrop it is painting', () => {
  test('a gift with no resolved attributes paints the base gift background', async () => {
    const gift = starGift({ background: { center_color: 0x537991, edge_color: 0x416479 } });
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

    expect(media.getAttribute('data-backdrop')).toBe('gift');
  });

  test('a resolved collectible paints its own backdrop', async () => {
    const gift = {
      ...starGift({ background: { center_color: 0x537991, edge_color: 0x416479 } }),
      attributes: [{ _: 'starGiftAttributeBackdrop', name: 'Indigo', center_color: 0x112233, edge_color: 0x445566 }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

    expect(media.getAttribute('data-backdrop')).toBe('attribute');
    expect(media.getAttribute('style') || '').toContain('#112233');
  });

  test('a gift with neither says so', async () => {
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift: starGift({ background: undefined }) }), {});
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-backdrop')).toBe('none');
  });
});

describe('the motif tile has one size, shared by the card and the sheet', () => {
  const css = () => require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

  test('both backdrops are drawn by the one layer', () => {
    const src = css();

    const giftBlocks = Array.from(src.matchAll(/\.(?:tgui-gift-card__media|tgui-gift-detail__hero)\s*\{[^}]*\}/g))
      .map((m) => m[0]);
    expect(giftBlocks).toHaveLength(2);
    for (const b of giftBlocks) expect(b).not.toMatch(/background-size/);
    expect((src.match(/\.tgui-gift-backdrop__motif\s*\{/g) || [])).toHaveLength(1);
    expect((src.match(/\.tgui-gift-backdrop__halo\s*\{/g) || [])).toHaveLength(1);
  });

  test('there is no tile to configure, and nothing may bring one back', () => {
    const src = css();
    expect(src).not.toMatch(/gift-tile/);

    expect(src).not.toMatch(/--gift-pattern-alpha:/);
    const component = require('node:fs')
      .readFileSync(require.resolve('../src/components/gift-backdrop.tsx'), 'utf8');
    expect(component).not.toMatch(/TILE/);
    expect(component).not.toMatch(/--gift-pattern-alpha:/);
    expect(component).toMatch(/giftMotifLayout/);
  });
});

describe('a found motif is not thrown away by a re-render', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  function animatedGift(thumbUrl: string) {
    return {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7101, mime_type: 'video/webm', size: 4000,
          thumbs: [{ _: 'photoSize', type: 'm', w: 120, h: 120, url: thumbUrl }],
        },
      }],
    };
  }

  test('the motif survives a re-render of the same card', async () => {
    const withPattern = (thumb: any) => ({
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7101, mime_type: 'video/webm', size: 4000, thumbs: [thumb],
        },
      }],
    });
    const thumb = { _: 'photoSize', type: 'm', w: 120, h: 120, url: 'blob:motif-keep' };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const draw = (gift: any) => render(() => h(MessageItem as any, {
      m: giftMsg({ _: 'messageActionStarGift', gift }),
      sameSenderPrev: false, sameSenderNext: false, isGroup: false,
      documentUrls: {}, emojiUrls: {},
    } as any), container);

    draw(withPattern(thumb));
    await wait(30);
    const media = container.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(media.getAttribute('data-motif')).toBe('ready');

    draw(withPattern({ ...thumb }));
    await wait(30);
    const after = container.querySelector('.tgui-gift-card__media') as HTMLElement;
    expect(after.getAttribute('data-motif-src')).toBe('blob:motif-keep');
  });
});

describe('a painted motif is protected from the eviction sweep', () => {
  afterEach(() => {
    delete (window as any).__gramMediaRouter;
    document.body.innerHTML = '';
  });

  test('the card tells the router it is painting the tile', async () => {
    const retained: string[] = [];
    let released = 0;
    (window as any).__gramMediaRouter = {
      retainBlobUrl(url: string) {
        retained.push(url);
        return () => { released++; };
      },
    };

    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7301, mime_type: 'video/webm', size: 4000,
          thumbs: [{ _: 'photoSize', type: 'm', w: 120, h: 120, url: 'blob:tile-held' }],
        },
      }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    await wait(30);

    expect(retained).toContain('blob:tile-held');
    expect(released).toBe(0);
  });

  test('a card with no motif holds nothing', async () => {
    const retained: string[] = [];
    (window as any).__gramMediaRouter = {
      retainBlobUrl(url: string) { retained.push(url); return () => {}; },
    };
    await mount(giftMsg({ _: 'messageActionStarGift', starGift() }), {});
    await wait(20);
    expect(retained).toEqual([]);
  });
});

describe('a tile painted before the router exists is still protected', () => {
  afterEach(() => {
    delete (window as any).__gramMediaRouter;
    document.body.innerHTML = '';
  });

  test('registering late still happens, because the router announces itself', async () => {
    const retained: string[] = [];
    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: {
          _: 'document', id: 7401, mime_type: 'video/webm', size: 4000,
          thumbs: [{ _: 'photoSize', type: 'm', w: 120, h: 120, url: 'blob:tile-late' }],
        },
      }],
    };

    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    await wait(30);
    expect(retained).toEqual([]);

    (window as any).__gramMediaRouter = {
      retainBlobUrl(url: string) { retained.push(url); return () => {}; },
    };
    window.dispatchEvent(new CustomEvent('tg-media-router-ready'));
    await wait(20);

    expect(retained).toContain('blob:tile-late');
    expect(root).not.toBeNull();
  });
});

describe('a motif that carries no thumbnail is not left unpainted', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('a document with no thumbs at all says so in the DOM', async () => {
    const gift = {
      ...starGift(),
      attributes: [{
        _: 'starGiftAttributePattern',
        document: { _: 'document', id: 7501, mime_type: 'video/webm', size: 4000 },
      }],
    };
    const root = await mount(giftMsg({ _: 'messageActionStarGift', gift }), {});
    const media = root.querySelector('.tgui-gift-card__media') as HTMLElement;

    expect(media.getAttribute('data-motif-has-thumb')).toBe('false');
    expect(media.getAttribute('data-motif-mime')).toBe('video/webm');
    expect(media.getAttribute('data-motif-doc')).toBe('7501');
  });

  test('the report distinguishes a motif from no motif at all', () => {
    const { giftPatternInfo } = require('../dist/components/gift-pattern.js');
    expect(giftPatternInfo(starGift()).docId).toBe('none');
    expect(giftPatternInfo({
      attributes: [{
        _: 'starGiftAttributePattern',
        document: { _: 'document', id: 3, mime_type: 'application/x-tgsticker' },
      }],
    })).toEqual({ docId: '3', mime: 'application/x-tgsticker', animated: true, hasThumb: false });
  });
});

describe('a lottie motif is rendered, not treated as video', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('a tgs motif takes the renderer path, not the video element path', () => {
    const src = require('node:fs').readFileSync(
      require.resolve('../src/components/gift-pattern.ts'), 'utf8');

    expect(src).toMatch(/snapshotTgsFrame/);
    expect(src).toMatch(/snapshotWebmFrame/);
    expect(src).toMatch(/initAnimatedRenderer\(/);

    expect(src).toMatch(/toDataURL\('image\/png'\)/);
  });

  test('a lottie motif with no thumbnail still counts as a real motif', () => {
    const { giftPatternInfo } = require('../dist/components/gift-pattern.js');
    const info = giftPatternInfo({
      attributes: [{
        _: 'starGiftAttributePattern',
        document: { _: 'document', id: 7601, mime_type: 'application/x-tgsticker' },
      }],
    });

    expect(info.animated).toBe(true);
    expect(info.hasThumb).toBe(false);
    expect(info.docId).toBe('7601');
  });
});

describe('the motif is a tinted silhouette, not the sticker as it comes', () => {
  const css = () => require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');

  test('the symbol is flooded with pattern_color, keeping only its own shape', () => {
    const { tintMotifSilhouette } = require('../dist/components/gift-pattern-layout.js');

    const ops: string[] = [];
    const ctx: any = {
      globalCompositeOperation: '',
      fillStyle: '',
      fillRect: () => ops.push(ctx.globalCompositeOperation),
    };
    tintMotifSilhouette(ctx, '#334455', 4, 4);
    expect(ops).toEqual(['source-atop']);

    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  test('the symbol is stamped at Telegram\'s coordinates, one drawing each', () => {
    const layout = require('../dist/components/gift-pattern-layout.js');

    expect(layout.GIFT_MOTIF_ALPHA).toEqual({ min: 0.1, mid: 0.2, max: 0.3 });
    expect(layout.GIFT_MOTIF_CANVAS).toEqual({ width: 266, height: 184 });
    expect(layout.GIFT_MOTIF_CANVAS_SMALL).toEqual({ width: 120, height: 120 });
    expect(layout.GIFT_MOTIF_POSITIONS).toHaveLength(18);
    expect(layout.GIFT_MOTIF_POSITIONS_SMALL).toHaveLength(8);

    const MAX = layout.GIFT_MOTIF_ALPHA.max;
    const MID = layout.GIFT_MOTIF_ALPHA.mid;
    const MIN = layout.GIFT_MOTIF_ALPHA.min;
    expect(layout.GIFT_MOTIF_POSITIONS).toEqual([
      [55, 47, 18, MAX], [23, 26, 18, MID], [0, 64, 18, MID], [0, 165, 18, MIN],
      [17, 125, 18, MID], [58, 141, 22, MAX], [81, 13, 24, MAX], [38, 82, 26, MAX],
      [187, 46, 18, MAX], [219, 26, 18, MID], [119, 5, 18, MAX], [242, 64, 18, MID],
      [245, 165, 18, MIN], [225, 125, 18, MID], [118, 151, 22, MAX], [180, 141, 22, MAX],
      [155, 13, 24, MAX], [196, 82, 26, MAX],
    ]);
    expect(layout.GIFT_MOTIF_POSITIONS_SMALL).toEqual([
      [49, 1, 20, MAX], [93, 12, 20, MAX], [99, 42, 20, MAX], [89, 86, 20, MAX],
      [49, 97, 20, MAX], [9, 86, 20, MAX], [0, 42, 20, MAX], [5, 12, 20, MAX],
    ]);

    expect(new Set(layout.GIFT_MOTIF_POSITIONS.map((p: any) => p[3])).size).toBe(3);
    expect(layout.giftMotifLayout(false)).toMatchObject({ width: 266, height: 184 });
    expect(layout.giftMotifLayout(true)).toMatchObject({ width: 120, height: 120 });
  });

  test('every stamp is drawn once, scaled by the device ratio, at its own weight', () => {
    const layout = require('../dist/components/gift-pattern-layout.js');
    const calls: any[] = [];
    const ctx: any = { globalAlpha: 1, globalCompositeOperation: '', fillStyle: '', fillRect: () => {} };
    const image: any = {};
    ctx.drawImage = (...a: any[]) => calls.push({ a, alpha: ctx.globalAlpha });
    layout.paintGiftMotif(image, {
      ctx,
      width: 266,
      height: 184,
      positions: layout.GIFT_MOTIF_POSITIONS,
      dpr: 2,
      color: null,
    });
    expect(calls).toHaveLength(18);
    expect(calls[0].a).toEqual([image, 110, 94, 36, 36]);
    expect(calls[0].alpha).toBe(layout.GIFT_MOTIF_ALPHA.max);
    expect(ctx.globalAlpha).toBe(1);

    expect(calls.some((c) => c.a[1] === 0)).toBe(true);
  });

  test('the tint covers the whole canvas, not each stamp', () => {
    const layout = require('../dist/components/gift-pattern-layout.js');
    const fills: any[] = [];
    const ctx: any = { globalAlpha: 1, globalCompositeOperation: '', fillStyle: '', fillRect: (...a: any[]) => fills.push(a), drawImage: () => {} };
    layout.paintGiftMotif({} as any, {
      ctx,
      width: 266,
      height: 184,
      positions: layout.GIFT_MOTIF_POSITIONS,
      dpr: 2,
      color: '#334455',
    });

    expect(fills).toEqual([[0, 0, 532, 368]]);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  test('pattern_color is read off the backdrop', () => {
    const { giftPatternColor } = require('../dist/components/gift-shared.js');
    expect(giftPatternColor({
      attributes: [{ _: 'starGiftAttributeBackdrop', pattern_color: 0x334455 }],
    })).toBe('#334455');
    expect(giftPatternColor({ attributes: [] })).toBeNull();
  });
});

describe('both gift surfaces are drawn by one component', () => {
  const read = (rel: string) => require('node:fs').readFileSync(require.resolve(rel), 'utf8');

  test('the card and the sheet both use GiftBackdrop', () => {
    expect(read('../src/components/gift-card.tsx')).toMatch(/<GiftBackdrop/);
    expect(read('../src/components/gift-detail.tsx')).toMatch(/<GiftBackdrop/);
  });

  test('neither hand-rolls its own backdrop layer any more', () => {
    const css = read('../dist/styles.css');

    expect(css).not.toMatch(/\.tgui-gift-card__media::before/);
    expect(css).not.toMatch(/\.tgui-gift-detail__hero::before/);

    expect(css.match(/\.tgui-gift-backdrop__motif\s*\{/g) || []).toHaveLength(1);
    expect(css.match(/\.tgui-gift-backdrop__halo\s*\{/g) || []).toHaveLength(1);
  });

  test('the surfaces differ only in which of the Telegram layouts they draw', () => {
    const src = read('../src/components/gift-backdrop.tsx');
    expect(src).toMatch(/variant\?: GiftBackdropVariant/);

    expect(src).toMatch(/giftMotifLayout/);
    expect(src).not.toMatch(/ALPHA/);
    expect(src).not.toMatch(/TILE/);
    expect((src.match(/giftMotifLayout\(/g) || [])).toHaveLength(1);
    expect(src).toMatch(/giftPatternColor\(/);

    expect(src).toMatch(/GIFT_HALO_OFFSET_Y/);
  });

  test('the card asks for the card layout and the sheet for the header one', () => {
    expect(read('../src/components/gift-card.tsx')).toMatch(/variant="card"/);
    expect(read('../src/components/gift-detail.tsx')).toMatch(/variant="hero"/);
  });

  test('the motif no longer waits a second before it is even attempted', () => {
    const src = read('../src/components/gift-pattern.ts');

    expect(src).not.toMatch(/tries === 4/);
    expect(src).toMatch(/snapshotVideoFrame\(doc, docId\)\.then/);
  });
});

describe('the text and the backdrop sit on one line, as on the reference card', () => {
  const css = () => require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
  const rule = (name: string) => new RegExp('\\.' + name + '\\s*\\{([^}]*)\\}').exec(css())![1];
  const inset = (name: string) => {
    const m = /(?:margin|padding):\s*[^;]*?var\(--gift-card-inset,\s*(\d+)px\)/.exec(rule(name));
    return m ? Number(m[1]) : null;
  };

  test('the copy shares one inset, and the backdrop sits one step outside it', () => {
    const values = [
      inset('tgui-gift-card__head'),
      inset('tgui-gift-card__comment'),
      inset('tgui-gift-card__action'),
    ];
    expect(values).toEqual([8, 8, 8]);
    const media = /(?:margin|padding):\s*0 (\d+)px/.exec(rule('tgui-gift-card__media'));
    expect(media).not.toBeNull();
    expect(Number(media![1])).toBe(4);
  });

  test('the card is wide enough for the text once the backdrop is inset', () => {
    const card = rule('tgui-gift-card');
    const width = /--gift-card-width,\s*(\d+)px/.exec(card)![1];

    expect(Number(width) - 2 * 8).toBeGreaterThanOrEqual(230);
    expect(Number(width) - 2 * 8).toBeLessThanOrEqual(236);
  });

  test('the backdrop is a rounded panel inside the card, not the card itself', () => {
    const media = rule('tgui-gift-card__media');
    expect(media).toMatch(/border-radius:\s*16px/);
    expect(media).toMatch(/overflow:\s*hidden/);
  });
});

describe('the motif is decoded into pixels, never handed to CSS as a url', () => {
  const { GiftBackdrop } = require('../dist/components/gift-backdrop.js');

  function mount(props: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    render((() => h(GiftBackdrop as any, { gift: {}, variant: 'tile', ...props })) as any, container);
    return container.firstElementChild as HTMLElement;
  }

  test('no url reaches a css property, so a relative one cannot resolve against the stylesheet', () => {
    const node = mount({ motifUrl: 'pattern.png' });
    const style = node.getAttribute('style') || '';
    expect(style).not.toMatch(/url\(/);
    expect(style).not.toMatch(/--gift-pattern-url/);
    const css = require('node:fs').readFileSync(require.resolve('../dist/styles.css'), 'utf8');
    expect(css).not.toMatch(/mask-image/);
    node.remove();
  });

  test('a blob url from the router is carried through untouched', () => {
    const node = mount({ motifUrl: 'blob:abc-123' });

    expect(node.getAttribute('data-motif-src')).toBe('blob:abc-123');
    node.remove();
  });

  test('no motif means no layer, rather than a layer pointing at nothing', () => {
    const node = mount({});
    expect(node.getAttribute('style') || '').not.toMatch(/url\(/);
    expect(node.getAttribute('data-motif')).toBe('none');
    expect(node.getAttribute('data-motif-src')).toBe('');
    node.remove();
  });

  test('the layer says which of the two tables it drew', () => {
    const tile = mount({});
    expect(tile.getAttribute('data-motif-count')).toBe('8');
    expect(tile.getAttribute('data-motif-canvas')).toBe('120x120');
    tile.remove();
    const card = mount({ variant: 'card' });

    expect(card.getAttribute('data-motif-count')).toBe('18');
    expect(card.getAttribute('data-motif-canvas')).toBe('266x184');
    card.remove();
    const hero = mount({ variant: 'hero' });
    expect(hero.getAttribute('data-motif-count')).toBe('18');
    expect(hero.getAttribute('data-motif-canvas')).toBe('266x184');
    hero.remove();
  });

  test('each surface hangs its halo where Telegram hangs it', () => {
    expect(mount({ variant: 'card' }).getAttribute('style')).toMatch(/--gift-halo-offset-y:-150px/);
    expect(mount({ variant: 'hero' }).getAttribute('style')).toMatch(/--gift-halo-offset-y:-100px/);
    expect(mount({ variant: 'tile' }).getAttribute('style')).toMatch(/--gift-halo-offset-y:-50px/);
    const card = mount({ variant: 'card' });
    expect(card.getAttribute('data-halo-offset-y')).toBe('-150px');
    card.remove();
  });
});
