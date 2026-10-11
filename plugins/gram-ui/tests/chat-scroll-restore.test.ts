/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { ChatArea } from '../dist/components/chat-area.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const ROW_H = 48;
const CLIENT_H = 200;
const peer = { type: 'user', id: 1 };

function messages(count: number): any[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    date: 1700000000 + i * 600,
    message: 'm' + (i + 1),
    out: false,
  }));
}

function mount(state: any): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('style', 'display:flex;flex-direction:column;height:600px');
  document.body.appendChild(container);
  const Comp: any = () => h(ChatArea as any, { state, dispatch: () => {}, skills: [] });
  render(Comp, container);
  return container;
}

function stateFor(dialog: any, restoreKey: string | null): any {
  return {
    selectedPeer: peer,
    activeSkill: null,
    messages: messages(20),
    dialogs: [{ peer, ...dialog }],
    documentUrls: {},
    peerWallpapers: {},
    defaultWallpaper: null,
    loadingMessages: false,
    scrollRestoreKey: restoreKey,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 60));

async function scrollTopFor(dialog: any, restoreKey: string | null): Promise<number> {
  document.body.innerHTML = '';
  const c = mount(stateFor(dialog, restoreKey));
  await settle();
  const list = c.querySelector('#tg-msg-list-content') as HTMLElement;
  const top = list ? list.scrollTop : -1;
  document.body.innerHTML = '';
  return top;
}

describe('chat scroll restore', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => CLIENT_H });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 20 * ROW_H });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as any).clientHeight;
    delete (HTMLElement.prototype as any).scrollHeight;
    document.body.innerHTML = '';
  });

  test('opens at the saved position instead of jumping to the first unread', async () => {
    const unread = { unreadCount: 3, readInboxMaxId: 5 };
    const restored = await scrollTopFor(unread, '2');
    const firstUnread = await scrollTopFor(unread, null);
    expect(firstUnread).toBeGreaterThan(0);
    expect(restored).toBeLessThan(firstUnread);
    expect(restored).toBeGreaterThan(0);
  });

  test('pins to the bottom for a fully read chat', async () => {
    const top = await scrollTopFor({ unreadCount: 0, readInboxMaxId: 20 }, null);
    expect(top).toBe(20 * ROW_H - CLIENT_H);
  });

  test('a fully read chat with a saved position opens at that position', async () => {
    const read = { unreadCount: 0, readInboxMaxId: 20 };
    const restored = await scrollTopFor(read, '3');
    const bottom = await scrollTopFor(read, null);
    expect(bottom).toBe(20 * ROW_H - CLIENT_H);
    expect(restored).toBeLessThan(bottom);
    expect(restored).toBeGreaterThan(0);
  });
});
