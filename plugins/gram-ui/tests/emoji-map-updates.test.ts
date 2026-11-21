/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import {
    ensureEmojiStickers,
    getEmojiAlt,
    getEmojiDocId,
    isPreferredEmojiAlt,
    resolveEntityDocId,
} from '../src/components/emoji-store.js';

describe('emoji map identity', () => {
    test('a later full map snapshot replaces the earlier one', () => {
        ensureEmojiStickers();
        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', {
            detail: { map: { '😀': '1001' } },
        }));
        assert.equal(getEmojiDocId('😀'), '1001');

        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', {
            detail: { map: { '😀': '2002' } },
        }));
        assert.equal(getEmojiDocId('😀'), '2002');
    });

    test('an explicit custom emoji alt outranks the reverse pack index', () => {
        window.dispatchEvent(new CustomEvent('tg-emoji-doc-ready', {
            detail: { alt: '😃', docId: '3003' },
        }));
        assert.equal(getEmojiAlt('3003'), '😃');

        window.dispatchEvent(new CustomEvent('tg-custom-emoji-alt', {
            detail: { docId: '3003', alt: '😀' },
        }));
        assert.equal(getEmojiAlt('3003'), '😀');
    });

    test('an explicit entity document id is never replaced by a glyph mapping', () => {
        ensureEmojiStickers();
        window.dispatchEvent(new CustomEvent('tg-preferred-emoji-alts', {
            detail: { alts: ['😀', '1️⃣'] },
        }));
        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', {
            detail: { map: { '😀': '3003', '1\u20E3': '1258816259754044' } },
        }));
        assert.equal(isPreferredEmojiAlt('😀'), true);
        assert.equal(resolveEntityDocId('5192988444413938411', '1️⃣'), '5192988444413938411');
        assert.equal(resolveEntityDocId('9999', '😀'), '9999');
        assert.equal(resolveEntityDocId('9999', '🔥'), '9999');
    });

    test('a snapshot does not resurrect a stale local entry it replaces', () => {
        ensureEmojiStickers();
        window.dispatchEvent(new CustomEvent('tg-emoji-doc-ready', {
            detail: { alt: '🔥', docId: '4004' },
        }));
        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', {
            detail: { map: { '🔥': '5005' } },
        }));
        assert.equal(getEmojiDocId('🔥'), '5005');
    });

    test('a glyph learned from a server message maps to its custom pack doc', () => {
        ensureEmojiStickers();
        window.dispatchEvent(new CustomEvent('tg-emoji-glyph-doc', {
            detail: { alt: '1️⃣', docId: '5192988444413938411' },
        }));
        assert.equal(getEmojiDocId('1️⃣'), '5192988444413938411');
    });

    test('an effect animation doc never becomes an inline emoji even from a later map', () => {
        ensureEmojiStickers();
        window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', {
            detail: { map: { '🔥': '5046551865169281494' } },
        }));
        assert.equal(getEmojiDocId('🔥'), '5046551865169281494');
        window.dispatchEvent(new CustomEvent('tg-effect-doc-ids', {
            detail: { ids: ['5046551865169281494'] },
        }));
        assert.equal(getEmojiDocId('🔥'), undefined);
    });
});
