/**
 * @jest-environment jsdom
 */
import { createCallbacks } from '../src/app/gram-callbacks';

function makeState() {
  const ui: any = {
    state: { messages: [] as any[] },
    setMessages: (m: any[]) => { ui.state.messages = m; },
    setLoadingMessages: () => {},
    setTopics: () => {},
    setTopicsLoading: () => {},
    scrollChatToBottom: () => {},
    setDialogs: () => {},
    setError: () => {},
    setScrollRestore: (k: string | null) => { ui.restoreKey = k; },
    addLog: () => {},
    dispatch: (a: any) => {
      if (a.type === 'SET_MESSAGES') ui.state.messages = a.messages;
    },
  };
  const s: any = {
    selectedPeerRef: { current: { type: 'channel', id: '1', accessHash: '11', forum: true } },
    selectedTopicRef: { current: null },
    topicsCacheRef: { current: new Map() },
    scrollRestoreRef: { current: new Map() },
    tgui: { current: ui },
    tgService: { current: { fetchHistory: async () => ({ messages: [] }), readDiscussion: async () => {} } },
    messagesCache: { current: new Map() },
    dialogsRef: { current: [] },
    userNameMap: { current: new Map() },
    peerInfoMap: { current: new Map() },
    readOutboxMap: { current: new Map() },
    readInboxMap: { current: new Map() },
    loadingHistoryRef: { current: new Set() },
    historyInitRef: { current: new Set() },
    maxFetchedIdRef: { current: new Map() },
    historyEndRef: { current: new Set() },
    cancelDocumentDownloads: () => {},
    lastHeaderTyping: { current: '' },
  };
  return { s, ui };
}

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

function topicMsg(id: number) {
  return { id, fromId: null, sender: 'u', date: id, message: 'm' + id, out: false, peerId: null, replyToMsgId: 42 };
}

describe('topic re-entry after exhausted pagination', () => {
  test('cached topic messages are shown even when end-of-history is reached', async () => {
    const { s, ui } = makeState();
    const key = 'channel_1|t42';
    s.messagesCache.current.set(key, [topicMsg(90), topicMsg(91)]);
    s.maxFetchedIdRef.current.set(key, 90);
    s.historyEndRef.current.add(key);
    const cb = createCallbacks(s, () => cb as any);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 42, title: 'T' });
    await tick();
    const ids = ui.state.messages.map((m: any) => m.id);
    expect(ids).toContain(90);
    expect(ids).toContain(91);
  });

  test('stale load for a previous topic does not overwrite the current view', async () => {
    const { s, ui } = makeState();
    let resolveFetch!: (v: any) => void;
    const gate = new Promise((r) => { resolveFetch = r; });
    let calls = 0;
    s.tgService.current.fetchHistory = () => {
      calls++;
      if (calls === 1) return gate;
      return Promise.resolve({ messages: [{ id: 50, from_id: null, date: 1, message: 'fresh-B', out: false }] });
    };
    const cb = createCallbacks(s, () => cb as any);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 42, title: 'A' });
    await tick(5);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 43, title: 'B' });
    await tick();
    resolveFetch({ messages: [{ id: 90, from_id: null, date: 1, message: 'old-A', out: false }] });
    await tick();
    const texts = ui.state.messages.map((m: any) => m.message);
    expect(texts).toContain('fresh-B');
    expect(texts).not.toContain('old-A');
  });
});
