/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { onRemoteEmojiInteraction, parseRemoteEmojiTaps, pickAnimIndex, resolveTapEmoticon } from '../src/app/gram-events';

describe('pickAnimIndex', () => {
  test('prefers an already cached anim document', () => {
    const ids = [101, 102, 103, 104];
    const cached = new Set(['102', '104']);
    assert.equal(pickAnimIndex(ids, (id) => cached.has(id), () => 0), 2);
    assert.equal(pickAnimIndex(ids, (id) => cached.has(id), () => 0.999), 4);
  });

  test('falls back to the whole pack when nothing is cached', () => {
    assert.equal(pickAnimIndex([11, 22, 33], () => false, () => 0.5), 2);
    assert.equal(pickAnimIndex([11, 22, 33], () => false, () => 0.99), 3);
  });

  test('returns zero for an empty pack', () => {
    assert.equal(pickAnimIndex([], () => false), 0);
  });
});

describe('resolveTapEmoticon', () => {
  test('prefers the clicked glyph over an ambiguous reverse index', () => {
    const packs = new Set(['😀', '😃']);
    const emoticon = resolveTapEmoticon(
      '😀',
      '777',
      () => '😃',
      (value) => packs.has(value),
      ['😃', '😀'],
      0,
    );
    assert.equal(emoticon, '😀');
  });

  test('falls back to the document alt and then the slot index', () => {
    const packs = new Set(['😃']);
    assert.equal(resolveTapEmoticon(undefined, '777', () => '😃', (v) => packs.has(v), [], 0), '😃');
    assert.equal(resolveTapEmoticon(undefined, undefined, () => undefined, () => null, ['🎉', '🔥'], 1), '🔥');
  });
});

describe('parseRemoteEmojiTaps', () => {
  test('keeps the indices and timings supplied by the server', () => {
    assert.deepEqual(
      parseRemoteEmojiTaps('{"a":[{"t":0,"i":2},{"t":1.5,"i":7}]}'),
      [{ t: 0, i: 2 }, { t: 1.5, i: 7 }],
    );
  });

  test('never invents an index for an empty or malformed interaction', () => {
    const payloads = [
      undefined,
      '',
      '{}',
      'null',
      'not-json',
      '{"a":[]}',
      '{"a":[{"t":0}]}',
      '{"a":[{"t":0,"i":0}]}',
      '{"a":[{"t":0,"i":-1}]}',
      '{"a":[{"t":0,"i":1.5}]}',
      '{"a":[{"t":0,"i":null}]}',
    ];
    for (const payload of payloads) {
      assert.deepEqual(parseRemoteEmojiTaps(payload), [], String(payload));
    }
  });
});

describe('onRemoteEmojiInteraction', () => {
  const state = () => ({ tgui: { current: null } } as any);

  test('plays nothing when the server sends no taps', async () => {
    const local: Event[] = [];
    const onLocal = (e: Event) => local.push(e);
    window.addEventListener('tg-interaction-local', onLocal);
    try {
      await onRemoteEmojiInteraction(state(), {
        kind: 'interaction',
        emoticon: '🔥',
        messageId: 'empty-' + Date.now(),
        interaction: '{}',
      });
      assert.equal(local.length, 0);
    } finally {
      window.removeEventListener('tg-interaction-local', onLocal);
    }
  });

  test('ignores a server tap with an invalid index', async () => {
    const local: Event[] = [];
    const onLocal = (e: Event) => local.push(e);
    window.addEventListener('tg-interaction-local', onLocal);
    try {
      await onRemoteEmojiInteraction(state(), {
        kind: 'interaction',
        emoticon: '🎉',
        messageId: 'invalid-' + Date.now(),
        interaction: '{"a":[{"t":0,"i":0}]}',
      });
      assert.equal(local.length, 0);
    } finally {
      window.removeEventListener('tg-interaction-local', onLocal);
    }
  });

  test('still processes a valid tap from the server payload', async () => {
    const local: Event[] = [];
    const onLocal = (e: Event) => local.push(e);
    window.addEventListener('tg-interaction-local', onLocal);
    try {
      await onRemoteEmojiInteraction(state(), {
        kind: 'interaction',
        emoticon: '🎉',
        messageId: 'server-' + Date.now(),
        interaction: '{"a":[{"t":0,"i":3}]}',
      });
      assert.equal(local.length, 1);
    } finally {
      window.removeEventListener('tg-interaction-local', onLocal);
    }
  });
});
