/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { isEmojiAtTextOffset, getEmojiAlt } from '../src/components/emoji-store.js';

describe('isEmojiAtTextOffset', () => {
  test('detects caret on plain emoji', () => {
    assert.equal(isEmojiAtTextOffset('hi 🎉 bye', 3), true);
    assert.equal(isEmojiAtTextOffset('hi 🎉 bye', 5), true);
  });

  test('rejects caret on plain text', () => {
    assert.equal(isEmojiAtTextOffset('hi 🎉 bye', 0), false);
    assert.equal(isEmojiAtTextOffset('hi 🎉 bye', 1), false);
    assert.equal(isEmojiAtTextOffset('plain', 2), false);
  });

  test('covers multi-unit sequences', () => {
    const text = 'a👨‍👩‍👧b';
    const start = text.indexOf('👨');
    assert.equal(isEmojiAtTextOffset(text, start + 2), true);
  });

  test('rejects out-of-range offsets', () => {
    assert.equal(isEmojiAtTextOffset('', 0), false);
    assert.equal(isEmojiAtTextOffset('🎉', -1), false);
    assert.equal(isEmojiAtTextOffset('🎉', 99), false);
  });
});

describe('getEmojiAlt index', () => {
  test('resolves alt by docId after doc-ready event', () => {
    window.dispatchEvent(new CustomEvent('tg-emoji-doc-ready', { detail: { alt: '🎉', docId: '99001' } }));
    assert.equal(getEmojiAlt('99001'), '🎉');
  });

  test('resolves custom alt by docId', () => {
    window.dispatchEvent(new CustomEvent('tg-custom-emoji-alt', { detail: { docId: '99002', alt: '🔥' } }));
    assert.equal(getEmojiAlt('99002'), '🔥');
  });

  test('returns undefined for unknown docId', () => {
    assert.equal(getEmojiAlt('no-such-doc'), undefined);
  });
});
