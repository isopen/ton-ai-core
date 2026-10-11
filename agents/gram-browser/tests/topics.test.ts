/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import {
  topicCacheKey,
  activeTopicId,
  topicIdOfRaw,
  repliedMsgIdOfRaw,
  messageInTopic,
} from '../src/app/gram-utils';
import type { GramState } from '../src/app/gram-state';

function stateWithTopic(topic: GramState['selectedTopicRef']['current']): GramState {
  return { selectedTopicRef: { current: topic } } as GramState;
}

describe('topicCacheKey', () => {
  test('plain peer key without topic', () => {
    assert.equal(topicCacheKey('channel_1'), 'channel_1');
    assert.equal(topicCacheKey('channel_1', 0), 'channel_1');
    assert.equal(topicCacheKey('channel_1', undefined), 'channel_1');
  });
  test('scoped key with topic', () => {
    assert.equal(topicCacheKey('channel_1', 42), 'channel_1|t42');
  });
  test('general topic shares the base key', () => {
    assert.equal(topicCacheKey('channel_1', 1), 'channel_1');
  });
});

describe('activeTopicId', () => {
  test('zero when no topic or peer mismatch', () => {
    assert.equal(activeTopicId(stateWithTopic(null), 'channel_1'), 0);
    assert.equal(
      activeTopicId(stateWithTopic({ peerKey: 'channel_2', topicId: 7, title: 't' }), 'channel_1'),
      0,
    );
  });
  test('topic id for matching peer', () => {
    assert.equal(
      activeTopicId(stateWithTopic({ peerKey: 'channel_1', topicId: 7, title: 't' }), 'channel_1'),
      7,
    );
  });
});

describe('topicIdOfRaw', () => {
  test('reads reply_to_top_id as the topic id', () => {
    assert.equal(
      topicIdOfRaw({ reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 12, reply_to_top_id: 9, forum_topic: true } }),
      9,
    );
  });
  test('reads reply_to_msg_id for the topic root reply', () => {
    assert.equal(
      topicIdOfRaw({ reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 9, forum_topic: true } }),
      9,
    );
  });
  test('zero for a plain reply without forum flags', () => {
    assert.equal(topicIdOfRaw({ reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 12 } }), 0);
  });
  test('zero without reply_to', () => {
    assert.equal(topicIdOfRaw({}), 0);
    assert.equal(topicIdOfRaw(null), 0);
    assert.equal(topicIdOfRaw({ reply_to: {} }), 0);
  });
});

describe('repliedMsgIdOfRaw', () => {
  test('reads the replied message id', () => {
    assert.equal(
      repliedMsgIdOfRaw({ reply_to: { reply_to_msg_id: 12, reply_to_top_id: 9, forum_topic: true } }),
      12,
    );
  });
  test('zero without reply_to', () => {
    assert.equal(repliedMsgIdOfRaw(null), 0);
  });
});

describe('messageInTopic', () => {
  test('everything visible without active topic', () => {
    assert.equal(messageInTopic(5, 0, 0), true);
    assert.equal(messageInTopic(5, 9, 0), true);
  });
  test('topic root itself is visible', () => {
    assert.equal(messageInTopic(9, 0, 9), true);
  });
  test('only matching replies visible in topic', () => {
    assert.equal(messageInTopic(10, 9, 9), true);
    assert.equal(messageInTopic(11, 8, 9), false);
    assert.equal(messageInTopic(12, 0, 9), false);
  });
  test('general shows untagged messages only', () => {
    assert.equal(messageInTopic(5, 0, 1), true);
    assert.equal(messageInTopic(1, 0, 1), true);
    assert.equal(messageInTopic(10, 42, 1), false);
  });
});
