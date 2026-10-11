/**
 * @jest-environment jsdom
 */
import { TelegramUI } from '../dist/telegram-ui.js';

function makeUi(): { ui: TelegramUI; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const callbacks: any = {
    sendCode: async () => {},
    signIn: async () => {},
    checkPassword: async () => {},
    sendMessage: async () => {},
    loadHistory: async () => {},
    logout: async () => {},
    selectPeer: () => {},
    selectTopic: () => {},
    requestQrCode: async () => {},
    sendTyping: () => {},
    sendTypingCancel: () => {},
  };
  const ui = new TelegramUI(container, callbacks);
  return { ui, container };
}

function mountList(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement {
  const list = document.createElement('div');
  list.id = 'tg-msg-list-content';
  Object.defineProperty(list, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
  document.body.appendChild(list);
  return list;
}

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe('scrollChatToBottom stickiness', () => {
  test('pins to bottom immediately', async () => {
    const { ui } = makeUi();
    try {
      mountList(100, 100, 1000);
      ui.scrollChatToBottom();
      await tick(100);
      const el = document.getElementById('tg-msg-list-content') as HTMLElement;
      expect(el.scrollTop).toBe(900);
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
    }
  });

  test('keeps pinning while content grows after the call', async () => {
    const { ui } = makeUi();
    try {
      const list = mountList(100, 100, 1000);
      ui.scrollChatToBottom();
      await tick(30);
      Object.defineProperty(list, 'scrollHeight', { value: 1400, writable: true, configurable: true });
      await tick(300);
      const el = document.getElementById('tg-msg-list-content') as HTMLElement;
      expect(el.scrollTop).toBe(1300);
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
    }
  });

  test('stops when the user scrolls up mid-retry', async () => {
    const { ui } = makeUi();
    try {
      const list = mountList(100, 100, 1000);
      ui.scrollChatToBottom();
      Object.defineProperty(list, 'scrollTop', { value: 50, writable: true, configurable: true });
      await tick(300);
      const el = document.getElementById('tg-msg-list-content') as HTMLElement;
      expect(el.scrollTop).toBe(50);
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
    }
  });
});
