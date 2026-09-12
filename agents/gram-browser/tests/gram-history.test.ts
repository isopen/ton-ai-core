import { strict as assert } from 'assert';
import {
  mergeHistoryMessages,
  insertHistoryMessage,
  trimHistoryMessages,
  filterDeletedMessages,
  sortHistoryMessages,
  minPositiveHistoryId,
  maxPositiveHistoryId,
} from '../src/app/gram-history';

function msg(id: number, extra: Record<string, unknown> = {}): any {
  return { id, fromId: null, sender: 'u', date: id * 10, message: 'm' + id, out: false, peerId: null, ...extra };
}

describe('mergeHistoryMessages', () => {
  test('unions fresh page with in-flight cache snapshot without loss', () => {
    const fresh = [msg(1), msg(2), msg(3)];
    const current = [msg(1), msg(2), msg(3), msg(4)];
    const merged = mergeHistoryMessages(fresh, current);
    assert.deepEqual(merged.map(m => m.id), [1, 2, 3, 4]);
  });

  test('dedupes ids repeated inside fresh page', () => {
    const merged = mergeHistoryMessages([msg(5), msg(5), msg(4)], [msg(3)]);
    assert.deepEqual(merged.map(m => m.id), [3, 4, 5]);
  });

  test('sorts out-of-order arrivals ascending', () => {
    const merged = mergeHistoryMessages([msg(9), msg(7)], [msg(8)]);
    assert.deepEqual(merged.map(m => m.id), [7, 8, 9]);
  });

  test('keeps optimistic negatives at the end', () => {
    const merged = mergeHistoryMessages([msg(10)], [msg(-3), msg(9)]);
    assert.deepEqual(merged.map(m => m.id), [9, 10, -3]);
  });
});

describe('insertHistoryMessage', () => {
  test('replaces existing id and reports isNew=false', () => {
    const r = insertHistoryMessage([msg(1), msg(2)], msg(2, { message: 'edited' }));
    assert.equal(r.isNew, false);
    assert.deepEqual(r.list.map(m => m.id), [1, 2]);
    assert.equal(r.list[1].message, 'edited');
  });

  test('inserts out-of-order id at sorted position and reports isNew=true', () => {
    const r = insertHistoryMessage([msg(1), msg(5)], msg(3));
    assert.equal(r.isNew, true);
    assert.deepEqual(r.list.map(m => m.id), [1, 3, 5]);
  });
});

describe('sortHistoryMessages', () => {
  test('does not mutate input', () => {
    const input = [msg(3), msg(1)];
    sortHistoryMessages(input);
    assert.deepEqual(input.map(m => m.id), [3, 1]);
  });
});

describe('trimHistoryMessages', () => {
  test('keeps newest N messages', () => {
    const list = Array.from({ length: 10 }, (_, i) => msg(i + 1));
    const trimmed = trimHistoryMessages(list, 4);
    assert.deepEqual(trimmed.map(m => m.id), [7, 8, 9, 10]);
  });

  test('returns same array when under limit', () => {
    const list = [msg(1)];
    assert.equal(trimHistoryMessages(list, 300), list);
  });
});

describe('filterDeletedMessages', () => {
  const list = [msg(1, { out: true }), msg(2, { out: false }), msg(3, { out: false })];

  test('selected peer removes incoming too', () => {
    const out = filterDeletedMessages(list, new Set([2, 3]), true);
    assert.deepEqual(out.map(m => m.id), [1]);
  });

  test('other peers keep incoming, drop own', () => {
    const out = filterDeletedMessages(list, new Set([1, 2]), false);
    assert.deepEqual(out.map(m => m.id), [2, 3]);
  });

  test('empty id set returns same array', () => {
    assert.equal(filterDeletedMessages(list, new Set(), true), list);
  });
});

describe('min/maxPositiveHistoryId', () => {
  test('ignores optimistic and zero ids', () => {
    const list = [msg(-5), msg(0), msg(7), msg(3)];
    assert.equal(minPositiveHistoryId(list), 3);
    assert.equal(maxPositiveHistoryId(list), 7);
  });

  test('empty list gives 0', () => {
    assert.equal(minPositiveHistoryId([]), 0);
    assert.equal(maxPositiveHistoryId([]), 0);
  });
});
