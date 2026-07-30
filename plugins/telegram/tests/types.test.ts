import { strict as assert } from 'assert';
import { toBigInt, hasValidAccessHash, serializePeer } from '../src/types';
import type { PeerInfo } from '../src/types';

test('toBigInt returns 0 for undefined', () => {
  assert.strictEqual(toBigInt(undefined), 0n);
});

test('toBigInt returns parsed value for valid string', () => {
  assert.strictEqual(toBigInt('12345'), 12345n);
});

test('toBigInt uses custom fallback', () => {
  assert.strictEqual(toBigInt(undefined, '42'), 42n);
});

test('toBigInt uses fallback on invalid input', () => {
  assert.strictEqual(toBigInt('not-a-number'), 0n);
});

test('hasValidAccessHash returns true for non-zero hash', () => {
  const peer: PeerInfo = { type: 'user', id: '1', accessHash: '12345' };
  assert.ok(hasValidAccessHash(peer));
});

test('hasValidAccessHash returns false for undefined hash', () => {
  const peer: PeerInfo = { type: 'user', id: '1' };
  assert.ok(!hasValidAccessHash(peer));
});

test('hasValidAccessHash returns false for zero hash', () => {
  const peer: PeerInfo = { type: 'user', id: '1', accessHash: '0' };
  assert.ok(!hasValidAccessHash(peer));
});

test('serializePeer user with accessHash', () => {
  const peer: PeerInfo = { type: 'user', id: '123', accessHash: '456' };
  const result = serializePeer(peer);
  assert.deepStrictEqual(result, { _: 'inputPeerUser', user_id: 123n, access_hash: 456n });
});

test('serializePeer user without accessHash', () => {
  const peer: PeerInfo = { type: 'user', id: '123' };
  const result = serializePeer(peer);
  assert.deepStrictEqual(result, { _: 'inputPeerUser', user_id: 123n, access_hash: 0n });
});

test('serializePeer chat', () => {
  const peer: PeerInfo = { type: 'chat', id: '456' };
  const result = serializePeer(peer);
  assert.deepStrictEqual(result, { _: 'inputPeerChat', chat_id: 456n });
});

test('serializePeer channel with accessHash', () => {
  const peer: PeerInfo = { type: 'channel', id: '789', accessHash: '101112' };
  const result = serializePeer(peer);
  assert.deepStrictEqual(result, { _: 'inputPeerChannel', channel_id: 789n, access_hash: 101112n });
});

test('serializePeer channel without accessHash', () => {
  const peer: PeerInfo = { type: 'channel', id: '789' };
  const result = serializePeer(peer);
  assert.deepStrictEqual(result, { _: 'inputPeerChannel', channel_id: 789n, access_hash: 0n });
});
