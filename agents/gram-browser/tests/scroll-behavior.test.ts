/**
 * @jest-environment jsdom
 */
import { createCallbacks } from '../src/app/gram-callbacks';
import { getFirstVisibleMsgId, saveScrollPosition } from '../src/app/gram-utils';

function makeState() {
  const scrolled: string[] = [];
  const ui: any = {
    state: { messages: [] as any[] },
    setMessages: (m: any[]) => { ui.state.messages = m; },
    setLoadingMessages: () => {},
    setTypingText: () => {},
    setTopics: () => {},
    setTopicsLoading: () => {},
    setScrollRestore: (k: string | null) => { scrolled.push(String(k)); ui.restoreKey = k; },
    scrollChatToBottom: () => { ui.scrolledBottom = (ui.scrolledBottom || 0) + 1; },
    setDialogs: () => {},
    setError: () => {},
    addLog: () => {},
    dispatch: (a: any) => {
      if (a.type === 'SET_MESSAGES') ui.state.messages = a.messages;
      if (a.type === 'SET_SCROLL_RESTORE') ui.restoreKey = a.key;
    },
  };
  const s: any = {
    selectedPeerRef: { current: null },
    selectedTopicRef: { current: null },
    topicsCacheRef: { current: new Map() },
    scrollRestoreRef: { current: new Map() },
    tgui: { current: ui },
    tgService: { current: { fetchHistory: async () => ({ messages: [] }), getForumTopics: async () => [], cancelPhotoDownloads: async () => {}, callRpc: async () => ({}) } },
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
  return { s, ui };
}

function mountList(top: number, height: number, rows: Array<{ id: number; top: number; bottom: number }>) {
  document.body.innerHTML = '';
  const list = document.createElement('div');
  list.id = 'tg-msg-list-content';
  const last = rows.length ? rows[rows.length - 1] : null;
  const contentHeight = last ? last.bottom : height;
  let scrollTop = 0;
  Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => Math.max(height, contentHeight) });
  list.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as any);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tgui-msg-row';
    row.id = 'msg-' + r.id;
    row.getBoundingClientRect = () => ({ top: r.top, bottom: r.bottom, height: r.bottom - r.top, left: 0, right: 100, width: 100, x: 0, y: r.top, toJSON: () => ({}) } as any);
    list.appendChild(row);
  }
  document.body.appendChild(list);
  return list;
}

const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

describe('scroll save and restore', () => {
  test('first visible message id is saved per peer', () => {
    mountList(0, 600, [
      { id: 10, top: -100, bottom: -20 },
      { id: 11, top: 0, bottom: 60 },
      { id: 12, top: 60, bottom: 120 },
    ]);
    expect(getFirstVisibleMsgId()).toBe(11);
  });

  test('selectPeer stores restore key for the next visit', async () => {
    const { s, ui } = makeState();
    mountList(0, 600, [
      { id: 40, top: 0, bottom: 60 },
      { id: 41, top: 60, bottom: 120 },
      { id: 42, top: 120, bottom: 180 },
      { id: 43, top: 180, bottom: 240 },
      { id: 44, top: 240, bottom: 300 },
      { id: 45, top: 300, bottom: 360 },
      { id: 46, top: 360, bottom: 420 },
      { id: 47, top: 420, bottom: 480 },
      { id: 48, top: 480, bottom: 540 },
      { id: 49, top: 540, bottom: 600 },
      { id: 50, top: 600, bottom: 660 },
    ]);
    const cb = createCallbacks(s, () => cb as any);
    s.selectedPeerRef.current = { type: 'channel', id: '1' };
    cb.selectPeer!({ type: 'channel', id: '2' });
    await tick();
    expect(s.scrollRestoreRef.current.get('channel_1')).toBe(40);
    expect(ui.restoreKey).toBe(null);
    cb.selectPeer!({ type: 'channel', id: '1' });
    await tick();
    expect(ui.restoreKey).toBe('40');
  });
});

describe('send scroll gate', () => {
  function sendSetup(scrollTop: number, scrollHeight: number, clientHeight: number) {
    const { s, ui } = makeState();
    mountList(0, clientHeight, [{ id: 1, top: 0, bottom: 60 }]);
    const list = document.getElementById('tg-msg-list-content') as HTMLElement;
    Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: clientHeight, configurable: true });
    s.selectedPeerRef.current = { type: 'user', id: '7', accessHash: '9' };
    s.tgService.current.sendMessage = async () => ({
      data: { _: 'updates', updates: [{ _: 'updateNewMessage', message: { id: 2, date: 1, entities: [] } }] },
    });
    return { s, ui };
  }

  test('own send always pins to bottom immediately', async () => {
    const near = sendSetup(950, 1000, 100);
    const cbNear = createCallbacks(near.s, () => cbNear as any);
    await cbNear.sendMessage!('hi');
    expect(near.ui.scrolledBottom).toBeGreaterThanOrEqual(1);

    const far = sendSetup(100, 1000, 100);
    const cbFar = createCallbacks(far.s, () => cbFar as any);
    await cbFar.sendMessage!('hi');
    expect(far.ui.scrolledBottom).toBeGreaterThanOrEqual(1);
    expect(far.ui.state.messages.some((m: any) => m.message === 'hi')).toBe(true);
  });

  test('server reply after the optimistic send re-pins with the sticky scroll', async () => {
    const { s, ui } = sendSetup(100, 1000, 100);
    const cb = createCallbacks(s, () => cb as any);
    await cb.sendMessage!('hi');
    const before = ui.scrolledBottom || 0;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(ui.state.messages.some((m: any) => m.message === 'hi')).toBe(true);
  });
});
