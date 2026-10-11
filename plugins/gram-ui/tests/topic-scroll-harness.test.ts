/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { ChatArea } from '../dist/components/chat-area.js';
import { GotoBottomButton } from '../dist/components/goto-bottom.js';
import { scrollListToBottom } from '../dist/components/goto-bottom.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const peer = { type: 'channel', id: 1, accessHash: '11', forum: true };
const ROW_H = 74;
const CLIENT_H = 200;
let SH = 20 * ROW_H;
const IDS_A = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101];

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function topicMsg(id: number, topicId: number): any {
  return { id, fromId: null, sender: 'u', date: 1700000000 + id, message: 'm' + id, out: false, peerId: null, replyToMsgId: topicId };
}

function baseState(topicId: number | null): any {
  return {
    selectedPeer: peer,
    selectedTopic: topicId == null ? null : { peerKey: 'channel_1', topicId, title: 'T' + topicId },
    activeSkill: null,
    messages: [],
    dialogs: [{ peer, unreadCount: 0, readInboxMaxId: 0 }],
    documentUrls: {},
    peerWallpapers: {},
    defaultWallpaper: null,
    loadingMessages: false,
    scrollRestoreKey: null,
  };
}

function installLayout() {
  SH = 20 * ROW_H;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => CLIENT_H });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => SH });
}

function removeLayout() {
  delete (HTMLElement.prototype as any).clientHeight;
  delete (HTMLElement.prototype as any).scrollHeight;
}

function wireList(list: HTMLElement, ids: number[]) {
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(String(id), i));
  let st = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => st,
    set: (v: number) => {
      st = Math.max(0, Math.min(v, SH - CLIENT_H));
      list.dispatchEvent(new Event('scroll'));
    },
  });
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => CLIENT_H });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => SH });
  const rect = (top: number) => ({ top, bottom: top + ROW_H, height: ROW_H, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) } as any);
  Object.defineProperty(list, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: CLIENT_H, height: CLIENT_H, left: 0, right: 800, width: 800, x: 0, y: 0, toJSON: () => ({}) } as any) });
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.tgui-msg-row'));
  rows.forEach((row) => {
    const m = /^msg-(\d+)$/.exec(row.id);
    const i = m && index.has(m[1]) ? index.get(m[1])! : 0;
    row.getBoundingClientRect = () => rect(i * ROW_H - st);
  });
  return { read: () => st, write: (v: number) => { list.scrollTop = v; } };
}

function mountChatArea(state: any) {
  const container = document.createElement('div');
  container.setAttribute('style', 'display:flex;flex-direction:column;height:600px');
  document.body.appendChild(container);
  let setState: ((v: any) => void) | null = null;
  const Host: any = () => {
    const [st, set] = useState(state);
    setState = set;
    return h(ChatArea as any, { state: st, dispatch: () => {}, skills: [] });
  };
  render(Host, container);
  return { container, update: (v: any) => (setState as any)(v) };
}

describe('forum topic scroll harness', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    installLayout();
  });

  afterEach(() => {
    removeLayout();
    document.body.innerHTML = '';
  });

  test('re-entering a topic opens at the row the user stopped at', async () => {
    const first = mountChatArea({ ...baseState(42), messages: IDS_A.map((id) => topicMsg(id, 42)) });
    await settle();
    const list = first.container.querySelector('#tg-msg-list-content') as HTMLElement;
    const handle = wireList(list, IDS_A);
    handle.write(3 * ROW_H);
    await settle(40);
    expect(handle.read()).toBe(3 * ROW_H);

    const second = mountChatArea({ ...baseState(43), messages: [] });
    await settle(60);
    document.body.innerHTML = '';
    document.body.appendChild(second.container);

    const third = mountChatArea({ ...baseState(42), messages: IDS_A.map((id) => topicMsg(id, 42)), scrollRestoreKey: String(IDS_A[3]) });
    await settle();
    const list3 = third.container.querySelector('#tg-msg-list-content') as HTMLElement;
    expect(list3.scrollTop).toBe(3 * ROW_H);
  });

  test('the down button holds the very bottom against late growth', async () => {
    const host = mountChatArea({ ...baseState(42), messages: IDS_A.map((id) => topicMsg(id, 42)) });
    await settle();
    const list = host.container.querySelector('#tg-msg-list-content') as HTMLElement;
    const handle = wireList(list, IDS_A);
    handle.write(0);
    await settle(40);

    const btnHost = document.createElement('div');
    document.body.appendChild(btnHost);
    render(() => h(GotoBottomButton as any, { visible: true, newCount: 0, onGo: () => scrollListToBottom() }) as any, btnHost);
    const btn = btnHost.querySelector('.tgui-goto-bottom') as HTMLElement;
    expect(btn).not.toBeNull();
    const bottomBefore = SH - CLIENT_H;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handle.read()).toBe(bottomBefore);

    SH = 26 * ROW_H;
    await settle(80);
    expect(handle.read()).toBe(SH - CLIENT_H);
  });

  test('the count above the button matches the messages below the viewport', async () => {
    const host = mountChatArea({ ...baseState(42), messages: IDS_A.map((id) => topicMsg(id, 42)) });
    await settle();
    const list = host.container.querySelector('#tg-msg-list-content') as HTMLElement;
    const handle = wireList(list, IDS_A);
    handle.write(0);
    await settle(320);
    const count = host.container.querySelector('.tgui-goto-bottom-count');
    expect(count).not.toBeNull();
    const atTop = Number(count!.textContent);
    expect(atTop).toBe(IDS_A.length - 3);

    handle.write(3 * ROW_H);
    await settle(120);
    const lower = Number(host.container.querySelector('.tgui-goto-bottom-count')!.textContent);
    expect(lower).toBe(IDS_A.length - 6);

    handle.write(SH - CLIENT_H);
    await settle(320);
    expect(host.container.querySelector('.tgui-goto-bottom')).toBeNull();
    expect(host.container.querySelector('.tgui-goto-bottom-count')).toBeNull();
  });
});
