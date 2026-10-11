/**
 * @jest-environment jsdom
 */
import { createCallbacks } from '../src/app/gram-callbacks';
import { scheduleMessagesFlush } from '../src/app/gram-utils';

function makeTopicState() {
  const sent: any[][] = [];
  const dispatched: any[] = [];
  const ui: any = {
    state: { messages: [] as any[] },
    setMessages: (m: any[]) => { ui.state.messages = m; },
    scrollChatToBottom: () => {},
    setDialogs: () => {},
    setError: () => {},
    addLog: () => {},
    dispatch: (a: any) => {
      dispatched.push(a);
      if (a.type === 'SET_MESSAGES') ui.state.messages = a.messages;
    },
  };
  const s: any = {
    selectedPeerRef: { current: { type: 'channel', id: '1', accessHash: '11', forum: true } },
    selectedTopicRef: { current: { peerKey: 'channel_1', topicId: 42, title: 'T' } },
    tgui: { current: ui },
    tgService: {
      current: {
        sendMessage: (...a: any[]) => {
          sent.push(a);
          return Promise.resolve({
            data: {
              _: 'updates',
              updates: [{ _: 'updateNewChannelMessage', message: { id: 100, date: 1700000000, entities: [] } }],
            },
          });
        },
      },
    },
    messagesCache: { current: new Map() },
    dialogsRef: { current: [] },
    messageFlushRef: { current: null },
  };
  return { s, ui, sent, dispatched };
}

const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

describe('topic send and live updates', () => {
  test('sendMessage passes reply_to topic id and keeps the sent message visible', async () => {
    const { s, ui, sent } = makeTopicState();
    const cb = createCallbacks(s, () => cb as any);
    await cb.sendMessage!('hello topic');
    expect(sent.length).toBe(1);
    expect(sent[0][3]).toBe(42);
    const ids = ui.state.messages.map((m: any) => m.id);
    expect(ids).toContain(100);
  });

  test('flush dispatches topic cache while viewing the topic', async () => {
    const { s, ui } = makeTopicState();
    s.messagesCache.current.set('channel_1|t42', [
      { id: 90, fromId: null, sender: 'u', date: 1, message: 'in-topic', out: false, peerId: null, replyToMsgId: 42 },
    ]);
    s.messagesCache.current.set('channel_1', []);
    scheduleMessagesFlush(s);
    await tick();
    const sets = ui.state.messages;
    expect(sets.some((m: any) => m.id === 90)).toBe(true);
  });
});
