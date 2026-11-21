import { api } from 'sdk';
import { fixtureStats } from '../lib/fixtures.js';
import { galleryTeaser, galleryWidget } from '../lib/widget.js';

const APP_URL = 'https://app9208241906.tgcloud.ai/';

let widgetsBlocked = false;

function openKeyboard(isPrivate) {
    if (!APP_URL) return undefined;
    return {
        inline_keyboard: [[
            isPrivate
                ? { text: '🖼 Open gallery', web_app: { url: APP_URL } }
                : { text: '🖼 Open gallery', url: APP_URL },
        ]],
    };
}

export default async function (message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    const isPrivate = message.chat.type === 'private';
    const stats = fixtureStats();
    const keyboard = openKeyboard(isPrivate);
    const reply = (body, options = {}) => api.sendMessage({
        chat_id: chatId,
        text: body,
        ...(keyboard ? { reply_markup: keyboard } : {}),
        ...options,
    });

    if (text === '/start') {
        if (isPrivate && !widgetsBlocked) {
            try {
                await api.sendWidget({
                    chat_id: chatId,
                    html: galleryWidget(stats),
                    caption: `TGS Gallary — ${stats.count} animated emoji in ${stats.packs} packs.`,
                    allow_queries: false,
                });
                return;
            } catch (e) {
                widgetsBlocked = true;
                console.warn('sendWidget unavailable, using the button message:', e && e.message ? e.message : e);
            }
        }
        await reply(galleryTeaser(stats), { parse_mode: 'HTML' });
        return;
    }

    await reply('Open the Mini App with the button below or from the bot menu: paginated gallery, 50 emoji per page.');
}
