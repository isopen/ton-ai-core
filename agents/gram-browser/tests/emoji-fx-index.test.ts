/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { pickAnimIndex, resolveTapEmoticon } from '../src/app/gram-events';

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
