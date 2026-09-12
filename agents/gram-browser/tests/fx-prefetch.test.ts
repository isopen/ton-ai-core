import { strict as assert } from 'assert';
import { collectViewportEmoticons, extractEmoticons } from '../src/app/gram-history';

describe('collectViewportEmoticons', () => {
  test('collects unique emoticons from visible messages only', () => {
    const messages = [
      { id: 1, message: 'hi 🎉' },
      { id: 2, message: '🎉 again 🔥' },
      { id: 3, message: 'unseen 👀' },
    ];
    const out = collectViewportEmoticons(messages, [1, 2], 8);
    assert.deepEqual(out, ['🎉', '🔥']);
  });

  test('respects limit', () => {
    const messages = [{ id: 1, message: '🎉🔥✨🎂🍓' }];
    const out = collectViewportEmoticons(messages, [1], 2);
    assert.equal(out.length, 2);
  });

  test('ignores messages without emoticons and unknown ids', () => {
    const messages = [
      { id: 1, message: 'plain text' },
      { id: 2, message: '🔥' },
    ];
    assert.deepEqual(collectViewportEmoticons(messages, [1, 999], 8), []);
    assert.deepEqual(collectViewportEmoticons([], [1], 8), []);
  });
});
