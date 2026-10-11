/**
 * @jest-environment jsdom
 */

import { areChatAreaPropsEqual } from '../dist/components/chat-area.js';

const dispatch = () => {};
const skills: any[] = [];
const sharedPeer = { type: 'user', id: 1 };
const sharedDialogs: any[] = [];
const sharedUrls = {};
const sharedMessages: any[] = [];

function base(): any {
  return {
    state: {
      messages: sharedMessages,
      selectedPeer: sharedPeer,
      selectedTopic: null,
      scrollRestoreKey: null,
      dialogs: sharedDialogs,
      documentUrls: sharedUrls,
    },
    dispatch,
    skills,
  };
}

describe('chat area memo comparator', () => {
  test('ignores unrelated state churn', () => {
    const a = base();
    const b = base();
    b.state.connectionStatus = 'connecting';
    b.state.error = 'boom';
    expect(areChatAreaPropsEqual(a, b)).toBe(true);
  });

  test('re-renders when the selected topic changes', () => {
    const a = base();
    const b = base();
    b.state.selectedTopic = { topicId: 7, title: 'Topic' };
    expect(areChatAreaPropsEqual(a, b)).toBe(false);
  });

  test('re-renders when the scroll restore key changes', () => {
    const a = base();
    const b = base();
    b.state.scrollRestoreKey = '4242';
    expect(areChatAreaPropsEqual(a, b)).toBe(false);
  });

  test('re-renders when messages change', () => {
    const a = base();
    const b = base();
    b.state.messages = [{ id: 1 }];
    expect(areChatAreaPropsEqual(a, b)).toBe(false);
  });
});
