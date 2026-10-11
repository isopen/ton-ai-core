/**
 * @jest-environment jsdom
 */
import { createCallbacks } from '../src/app/gram-callbacks';
import { attachScrollRead, getFirstVisibleMsgId, saveScrollPosition, topicCacheKey } from '../src/app/gram-utils';

function makeState() {
  const restoreCalls: (string | null)[] = [];
  const ui: any = {
    state: { messages: [] as any[] },
    setMessages: (m: any[]) => { ui.state.messages = m; },
    setLoadingMessages: () => {},
    setTopics: () => {},
    setTopicsLoading: () => {},
    scrollChatToBottom: () => {},
    setDialogs: () => {},
    setError: () => {},
    setScrollRestore: (k: string | null) => { restoreCalls.push(k); ui.restoreKey = k; },
    addLog: () => {},
    dispatch: (a: any) => { if (a.type === 'SET_MESSAGES') ui.state.messages = a.messages; },
  };
  const s: any = {
    selectedPeerRef: { current: { type: 'channel', id: '1', accessHash: '11', forum: true } },
    selectedTopicRef: { current: null },
    topicsCacheRef: { current: new Map() },
    scrollRestoreRef: { current: new Map() },
    tgui: { current: ui },
    tgService: { current: { fetchHistory: async () => ({ messages: [] }), readHistory: async () => {}, readDiscussion: async () => {} } },
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
    scrollReadElRef: { current: null },
    scrollReadHandlerRef: { current: null },
    scrollReadRef: { current: null },
    readRetryTimersRef: { current: [] },
  };
  return { s, ui, restoreCalls };
}

function topicMsg(id: number, topicId: number) {
  return { id, fromId: null, sender: 'u', date: id, message: 'm' + id, out: false, peerId: null, replyToMsgId: topicId };
}

function mountList(ids: number[], scrollTop: number, scrollHeight: number, clientHeight: number) {
  document.body.innerHTML = '';
  const list = document.createElement('div');
  list.id = 'tg-msg-list-content';
  let st = scrollTop;
  Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => st, set: (v: number) => { st = v; } });
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  list.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight, height: clientHeight, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) } as any);
  ids.forEach((id, i) => {
    const row = document.createElement('div');
    row.className = 'tgui-msg-row';
    row.id = 'msg-' + id;
    const top = i * 60 - scrollTop;
    row.getBoundingClientRect = () => ({ top, bottom: top + 60, height: 60, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as any);
    list.appendChild(row);
  });
  document.body.appendChild(list);
  return list;
}

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe('topic scroll persistence', () => {
  test('leaving a topic saves the row under the topic cache key', async () => {
    const { s, ui } = makeState();
    const key = topicCacheKey('channel_1', 42);
    s.messagesCache.current.set(key, [90, 91, 92, 93, 94, 95].map((id) => topicMsg(id, 42)));
    mountList([90, 91, 92, 93, 94, 95], 120, 600, 400);
    const cb = createCallbacks(s, () => cb as any);
    s.selectedTopicRef.current = { peerKey: 'channel_1', topicId: 42, title: 'T' };
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 43, title: 'B' });
    await tick();
    expect(s.scrollRestoreRef.current.get(key)).toBe(92);
  });

  test('leaving from the very bottom stores no restore key', async () => {
    const { s } = makeState();
    const key = topicCacheKey('channel_1', 42);
    mountList([90, 91, 92, 93, 94, 95], 0, 360, 400);
    s.scrollRestoreRef.current.set(key, 92);
    saveScrollPosition(s, key);
    expect(s.scrollRestoreRef.current.has(key)).toBe(false);
  });

  test('scrolling saves the position continuously without an explicit switch', async () => {
    const { s } = makeState();
    const key = topicCacheKey('channel_1', 42);
    const { attachScrollRead } = require('../src/app/gram-utils') as typeof import('../src/app/gram-utils');
    s.selectedTopicRef.current = { peerKey: 'channel_1', topicId: 42, title: 'T' };
    mountList([90, 91, 92, 93, 94, 95], 120, 600, 400);
    attachScrollRead(s);
    const list = document.getElementById('tg-msg-list-content') as HTMLElement;
    list.dispatchEvent(new Event('scroll'));
    await tick(800);
    expect(s.scrollRestoreRef.current.get(key)).toBe(92);
  });

  test('a topic switch re-attaches the scroll listener to the new list element', async () => {
    const { s } = makeState();
    s.selectedTopicRef.current = { peerKey: 'channel_1', topicId: 42, title: 'T' };
    mountList([90, 91, 92, 93, 94, 95], 120, 1000, 200);
    attachScrollRead(s);
    const stale = document.getElementById('tg-msg-list-content');
    const cb = createCallbacks(s, () => cb as any);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 43, title: 'B' });
    mountList([200, 201, 202, 203], 0, 1000, 200);
    const fresh = document.getElementById('tg-msg-list-content');
    await tick(60);
    expect(stale).not.toBe(fresh);
    expect(s.scrollReadElRef.current).toBe(fresh);
    fresh!.dispatchEvent(new Event('scroll'));
    await tick(800);
    expect(s.scrollRestoreRef.current.get(topicCacheKey('channel_1', 43))).toBe(200);
  });

  test('returning to a topic restores the saved row', async () => {
    const { s, ui } = makeState();
    const key = topicCacheKey('channel_1', 42);
    s.messagesCache.current.set(key, [90, 91, 92, 93, 94, 95].map((id) => topicMsg(id, 42)));
    s.scrollRestoreRef.current.set(key, 92);
    mountList([90, 91, 92, 93, 94, 95], 0, 600, 400);
    const cb = createCallbacks(s, () => cb as any);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 42, title: 'T' });
    await tick();
    expect(ui.restoreKey).toBe('92');
    expect(getFirstVisibleMsgId()).toBe(90);
  });

  test('returning to a topic without a saved row stays at the bottom', async () => {
    const { s, ui } = makeState();
    const key = topicCacheKey('channel_1', 43);
    s.messagesCache.current.set(key, [200, 201, 202, 203].map((id) => topicMsg(id, 43)));
    mountList([200, 201, 202, 203], 0, 240, 400);
    const cb = createCallbacks(s, () => cb as any);
    cb.selectTopic!({ peerKey: 'channel_1', topicId: 43, title: 'B' });
    await tick();
    expect(ui.restoreKey).toBe(null);
  });
});
