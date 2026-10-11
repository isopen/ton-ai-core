import { getSchemaRegistry, SchemaSerializer, SchemaDeserializer } from '../src/schema-setup';

const registry = getSchemaRegistry();

function combinator(name: string) {
  const c = registry.findConstructorByName(name);
  if (!c) throw new Error('constructor not found: ' + name);
  return c;
}

function deepConvert(v: any): any {
  if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
    const name = v.constructorName;
    if (name === 'boolTrue') return true;
    if (name === 'boolFalse') return false;
    const r: any = { _: name };
    for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
    return r;
  }
  if (Array.isArray(v)) return v.map(deepConvert);
  if (v instanceof Buffer) return v.toString('hex');
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function roundTrip(name: string, params: Record<string, any>): any {
  const c = combinator(name);
  const body = new SchemaSerializer(registry).serializeCombinator(c, params);
  const d = new SchemaDeserializer(body, registry);
  return deepConvert(d.readBoxedObject());
}

const STICKER = {
  _: 'document',
  flags: 0,
  id: '5150',
  access_hash: '1111111111111111',
  file_reference: Buffer.from([1, 2, 3, 4]),
  date: 1700000000,
  mime_type: 'image/webp',
  size: 1024,
  attributes: [],
};

const GIFT_FLAGS = (1 << 0) | (1 << 5) | (1 << 13);

const GIFT = {
  _: 'starGift',
  flags: GIFT_FLAGS,
  id: '5150',
  sticker: STICKER,
  stars: '25',
  title: 'Plush Pepe',
  availability_remains: 12,
  availability_total: 100,
  background: { _: 'starGiftBackground', center_color: 0x3355ff, edge_color: 0x7722aa, text_color: 0xffffff },
};

describe('a gift survives the wire layer', () => {
  test('the starGift constructor reaches the client with its sticker and title', () => {
    const gift = roundTrip('starGift', GIFT);
    expect(gift._).toBe('starGift');
    expect(gift.title).toBe('Plush Pepe');
    expect(gift.sticker?.mime_type).toBe('image/webp');
    expect(gift.availability_remains).toBe(12);
  });

  test('a webpage keeps its gift attribute, which is how a collectible arrives', () => {
    const wp = roundTrip('webPage', {
      _: 'webPage',

      flags: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 12),
      id: '900',
      url: 'https://t.me/nft/PlushPepe-2050',
      display_url: 't.me/nft/PlushPepe-2050',
      site_name: 'Telegram',
      title: 'Plush Pepe #2050',
      description: 'Gifted to Kallen T on 1 Dec 2024',
      type: 'telegram_nft_gift',
      attributes: [{ _: 'webPageAttributeUniqueStarGift', gift: GIFT }],
    });
    expect(wp.title).toBe('Plush Pepe #2050');
    expect(Array.isArray(wp.attributes)).toBe(true);

    expect(wp.attributes?.[0]?._).toBe('webPageAttributeUniqueStarGift');
    expect(wp.attributes?.[0]?.gift?.title).toBe('Plush Pepe');
    expect(wp.attributes?.[0]?.gift?.sticker?.mime_type).toBe('image/webp');

    expect(Number(wp.attributes?.[0]?.gift?.availability_remains)).toBe(12);
    expect(wp.attributes?.[0]?.gift?.background?.center_color).toBe(0x3355ff);
  });

  test('a service message carries the gift action', () => {
    const svc = roundTrip('messageService', {
      _: 'messageService',
      flags: 0,
      id: 81,
      from_id: { _: 'peerUser', user_id: '5' },
      peer_id: { _: 'peerUser', user_id: '7' },
      date: 1700000000,
      action: { _: 'messageActionStarGift', flags: 0, gift: GIFT },
    });
    expect(svc._).toBe('messageService');
    expect(svc.action?._).toBe('messageActionStarGift');
    expect(svc.action?.gift?.title).toBe('Plush Pepe');
  });

  test('a plain message has no action field at all in this layer', () => {
    const msg = roundTrip('message', {
      _: 'message',
      flags: 0,
      id: 82,
      from_id: { _: 'peerUser', user_id: '5' },
      peer_id: { _: 'peerUser', user_id: '7' },
      date: 1700000000,
      message: 'hi',
    });
    expect(msg._).toBe('message');

    expect(msg.action).toBeUndefined();
  });
});

describe('a collectible gift keeps its artwork on the wire', () => {
  const STAR_GIFT_UNIQUE_FLAGS = 0;

  function uniqueGiftWithArtwork(): any {
    return {
      _: 'starGiftUnique',
      flags: STAR_GIFT_UNIQUE_FLAGS,
      id: '999',
      gift_id: '5150',
      title: 'Plush Pepe',
      slug: 'PlushPepe-2050',
      num: 2050,
      attributes: [{
        _: 'starGiftAttributeModel',
        name: 'Yellow Hug',
        rarity: { _: 'starGiftAttributeRarity', permille: 30 },
        document: {
          _: 'document',
          id: '6001',
          access_hash: '111',
          file_reference: Buffer.from([1, 2, 3]),
          date: 1700000000,
          mime_type: 'application/x-tgsticker',
          size: 900,
          dc_id: 2,

          attributes: [],
        },
      }],
    };
  }

  test('the backdrop motif and its colours survive a full round trip', () => {
    const gift = roundTrip('payments.uniqueStarGift', {
      gift: {
        ...uniqueGiftWithArtwork(),
        attributes: [
          ...uniqueGiftWithArtwork().attributes,
          {
            _: 'starGiftAttributePattern',
            name: 'Lovely Kiss',
            rarity: { _: 'starGiftAttributeRarity', permille: 5 },
            document: {
              _: 'document',
              id: '6002',
              access_hash: '112',
              file_reference: Buffer.from([4, 5, 6]),
              date: 1700000000,
              mime_type: 'image/png',
              size: 4000,
              dc_id: 2,
              attributes: [],
            },
          },
          {
            _: 'starGiftAttributeBackdrop',
            name: 'Indigo Dye',
            backdrop_id: 7,
            center_color: 0x334455,
            edge_color: 0x445566,
            pattern_color: 0x556677,
            text_color: 0xffffff,
            rarity: { _: 'starGiftAttributeRarity', permille: 20 },
          },
        ],
      },
      chats: [],
      users: [],
    });

    const attrs = gift.gift?.attributes || [];
    const pattern = attrs.find((a: any) => a?._ === 'starGiftAttributePattern');

    expect(pattern).toBeDefined();
    expect(String(pattern.document?.id)).toBe('6002');
    expect(pattern.document?.mime_type).toBe('image/png');

    const backdrop = attrs.find((a: any) => a?._ === 'starGiftAttributeBackdrop');
    expect(String(backdrop?.backdrop_id)).toBe('7');
    expect(Number(backdrop?.center_color)).toBe(0x334455);
    expect(Number(backdrop?.edge_color)).toBe(0x445566);
  });

  test('the model document survives a full round trip', () => {
    const gift = roundTrip('payments.uniqueStarGift', {
      gift: uniqueGiftWithArtwork(),
      chats: [],
      users: [],
    });

    const attrs = gift.gift?.attributes;
    expect(Array.isArray(attrs)).toBe(true);
    const model = attrs?.find((a: any) => a?._ === 'starGiftAttributeModel');
    expect(model).toBeDefined();
    expect(model.name).toBe('Yellow Hug');

    expect(String(model.document?.id)).toBe('6001');
    expect(model.document?.mime_type).toBe('application/x-tgsticker');
    expect(model.rarity?.permille).toBe(30);
  });

  test('the collectible keeps the number and slug the sheet shows', () => {
    const gift = roundTrip('payments.uniqueStarGift', {
      gift: uniqueGiftWithArtwork(), chats: [], users: [],
    });
    expect(gift.gift?.num).toBe(2050);
    expect(gift.gift?.slug).toBe('PlushPepe-2050');
    expect(gift.gift?.title).toBe('Plush Pepe');
  });

  test('the artwork reference is JSON-safe for the message cache', () => {
    const gift = roundTrip('payments.uniqueStarGift', {
      gift: uniqueGiftWithArtwork(), chats: [], users: [],
    });
    const model = gift.gift?.attributes?.find((a: any) => a?._ === 'starGiftAttributeModel');

    expect(typeof model.document.file_reference).toBe('string');
    const back = JSON.parse(JSON.stringify(gift));
    expect(back.gift.attributes[0].document.id).toBe('6001');
  });

  test('a plain starGift still carries its own sticker', () => {
    const gift = roundTrip('starGift', {
      _: 'starGift',

      flags: (1 << 0) | (1 << 5),
      id: '5150',
      sticker: {
        _: 'document', id: '7001', access_hash: '222',
        file_reference: Buffer.from([4, 5, 6]), date: 1700000000,
        mime_type: 'application/x-tgsticker', size: 900, dc_id: 2,
        attributes: [],
      },
      stars: '25',
      availability_remains: 12,
      availability_total: 100,
      title: 'Plush Pepe',
    });
    expect(String(gift.sticker?.id)).toBe('7001');
    expect(gift.title).toBe('Plush Pepe');
  });
});
