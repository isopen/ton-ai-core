import { api } from 'sdk';
import { fixtureStats } from '../lib/fixtures.js';

const APP_URL = 'https://app9208241906.tgcloud.ai/';

export default async function (message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    const stats = fixtureStats();

    const keyboard = APP_URL
        ? { inline_keyboard: [[{ text: '🖼 Open gallery', web_app: { url: APP_URL } }]] }
        : undefined;
    const reply = (body) => api.sendMessage({
        chat_id: chatId,
        text: body,
        ...(keyboard ? { reply_markup: keyboard } : {}),
    });

    if (text === '/start') {
        await reply(`TGS Gallary — ${stats.count} animated emoji (${stats.bytes} bytes) on the Rust/WASM renderer.`);
        return;
    }

    await reply('Open the Mini App with the button below or from the bot menu: paginated gallery, 100 emoji per page.');
}
