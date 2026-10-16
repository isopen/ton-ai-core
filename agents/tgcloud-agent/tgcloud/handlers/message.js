import { api } from 'sdk';
import { TgcloudHelloPlugin } from '../lib/tgcloud-hello/index.js';

const APP_URL = 'https://hello.tgcloud.ai/';

export default async function (message) {
  const plugin = await TgcloudHelloPlugin.armed();
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text === '/start') {
    const keyboard = APP_URL
      ? { inline_keyboard: [[{ text: '🌍 Open', web_app: { url: APP_URL } }]] }
      : undefined;
    await api.sendMessage({
      chat_id: chatId,
      text: `${plugin.labelAt(0)}\n\nTap 🌍 Open (or the Mini App menu button) to cycle: ${plugin.getLabels().join(' → ')}`,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    return;
  }

  await api.sendMessage({ chat_id: chatId, text: plugin.labelAt(0) });
}
