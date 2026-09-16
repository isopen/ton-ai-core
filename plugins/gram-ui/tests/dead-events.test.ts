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
    signUp: async () => {},
    sendMessage: async () => {},
    loadHistory: async () => {},
    logout: async () => {},
    selectPeer: () => {},
    requestQrCode: async () => {},
    sendTyping: () => {},
    sendTypingCancel: () => {},
  };
  const ui = new TelegramUI(container, callbacks);
  return { ui, container };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

describe('dead action feedback', () => {
  test('voice event surfaces unavailable error', async () => {
    const { ui, container } = makeUi();
    try {
      window.dispatchEvent(new CustomEvent('tg-send-voice', { detail: { seconds: 2 } }));
      await tick();
      expect(ui.state.error).toBe('Voice messages are not supported yet');
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
      void container;
    }
  });

  test('gift event surfaces unavailable error', async () => {
    const { ui } = makeUi();
    try {
      window.dispatchEvent(new CustomEvent('tg-send-gift', { detail: { gift: {} } }));
      await tick();
      expect(ui.state.error).toBe('Star gifts are not supported yet');
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
    }
  });

  test('attach events surface unavailable error', async () => {
    const { ui } = makeUi();
    try {
      window.dispatchEvent(new CustomEvent('tg-attach-file'));
      await tick();
      expect(ui.state.error).toBe('Attachments are not supported yet');
      window.dispatchEvent(new CustomEvent('tg-attach-gallery'));
      await tick();
      expect(ui.state.error).toBe('Attachments are not supported yet');
      window.dispatchEvent(new CustomEvent('tg-attach-camera'));
      await tick();
      expect(ui.state.error).toBe('Attachments are not supported yet');
      window.dispatchEvent(new CustomEvent('tg-attach-location'));
      await tick();
      expect(ui.state.error).toBe('Attachments are not supported yet');
      window.dispatchEvent(new CustomEvent('tg-attach-more'));
      await tick();
      expect(ui.state.error).toBe('Attachments are not supported yet');
    } finally {
      ui.destroy();
      document.body.innerHTML = '';
    }
  });
});
