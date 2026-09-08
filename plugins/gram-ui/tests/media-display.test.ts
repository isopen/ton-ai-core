/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { MessageBubble } from '../dist/components/message-bubble.js';
import { MessageItem } from '../dist/components/chat-area.js';
import { EmojiText } from '../dist/components/emoji-text.js';
import { getMediaType, mediaFallbackText } from '../dist/utils.js';
import { t, S } from '@ton-ai/gram-lang';

if (typeof (global as any).IntersectionObserver === 'undefined') {
    (global as any).IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    const flat: any[] = [];
    const push = (c: any) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) { c.forEach(push); return; }
        if (typeof c === 'string' || typeof c === 'number') {
            flat.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
        } else {
            flat.push(c);
        }
    };
    children.forEach(push);
    const p = { ...props };
    if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
    return { type, props: p, children: flat, key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

const baseMsg = (over: any = {}) => ({
    id: 9001, date: 1788697000, out: false, sender: 'U',
    message: '', entities: [], media: null, ...over,
});

const itemProps = (m: any, extra: any = {}) => ({
    m, sameSenderPrev: false, sameSenderNext: false, isGroup: false,
    emojiUrls: {}, documentSources: {}, ...extra,
});

describe('chat text emoji display', () => {
    test('plain unicode emoji renders native glyph immediately', async () => {
        const c = mount(h(EmojiText as any, { text: 'hi 😀 bye', entities: [], documentUrls: {} }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent).toContain('😀');
        expect(c.textContent).toContain('hi');
    });

    test('custom emoji entity without url shows fallback glyph, not blank', async () => {
        const c = mount(h(EmojiText as any, {
            text: 'hi ❤',
            entities: [{ _: 'messageEntityCustomEmoji', offset: 3, length: 1, document_id: '999' }],
            documentUrls: {},
        }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('span.tgui-emoji-slot').length).toBe(1);
        expect(c.textContent).toContain('❤');
    });

    test('custom emoji entity with url keeps slot and glyph', async () => {
        const c = mount(h(EmojiText as any, {
            text: 'hi ❤',
            entities: [{ _: 'messageEntityCustomEmoji', offset: 3, length: 1, document_id: '999' }],
            documentUrls: { 'emojipack-999': 'blob:fake93' },
        }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('span.tgui-emoji-slot').length).toBe(1);
        expect(c.textContent).toContain('❤');
    });
});

describe('sticker display', () => {
    const webpDoc = {
        _: 'document', id: '11', mime_type: 'image/webp',
        attributes: [{ _: 'documentAttributeSticker', alt: '😀' }],
    };
    test('static sticker with url renders img', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDocument', document: webpDoc } });
        const c = mount(h(MessageItem as any, itemProps(m, { documentUrl: 'blob:stick1' })));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('div.tgui-sticker').length).toBe(1);
        expect(c.querySelectorAll('div.tgui-sticker img').length).toBe(1);
    });

    test('tgs sticker without url renders shell without crash', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDocument', document: { ...webpDoc, mime_type: 'application/x-tgsticker' } } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('div.tgui-sticker').length).toBe(1);
    });
});

describe('photo display', () => {
    const photoMedia = (sizes: any[]) => ({ _: 'messageMediaPhoto', photo: { _: 'photo', id: '21', sizes } });
    test('photo with url renders image box', async () => {
        const m = baseMsg({ media: photoMedia([{ _: 'photoSize', type: 'x', w: 640, h: 480, url: 'blob:photo1' }]) });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('div.TelegramImage').length).toBe(1);
    });

    test('photo without sizes renders placeholder text', async () => {
        const m = baseMsg({ media: photoMedia([]) });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent).toContain(t(S.PHOTO_PLACEHOLDER));
    });
});

describe('dice display', () => {
    test('dice renders loading placeholder without sets', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDice', emoticon: '🎲', value: 3 } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.querySelectorAll('span.tgui-dice-loading').length).toBe(1);
    });
});

describe('video display', () => {
    test('video without url renders loading state', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDocument', document: {
            _: 'document', id: '31', mime_type: 'video/mp4',
            attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 320, h: 240 }],
        } } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent || '').not.toContain(t(S.MESSAGE_UNSUPPORTED));
        expect(c.querySelectorAll('[data-role="loading-pct"], .video-message__loading-ring, video').length).toBeGreaterThan(0);
    });
});

describe('unsupported message fallback', () => {
    test('audio without filename shows unsupported notice', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDocument', document: {
            _: 'document', id: '41', mime_type: 'audio/ogg',
            attributes: [{ _: 'documentAttributeAudio', duration: 13 }],
        } } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent).toContain(t(S.MESSAGE_UNSUPPORTED));
    });

    test('document with filename shows filename, not notice', async () => {
        const m = baseMsg({ media: { _: 'messageMediaDocument', document: {
            _: 'document', id: '42', mime_type: 'application/pdf', file_name: 'report.pdf', attributes: [],
        } } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent).toContain('report.pdf');
        expect(c.textContent).not.toContain(t(S.MESSAGE_UNSUPPORTED));
    });

    test('unknown media shows unsupported notice, never empty bubble', async () => {
        const m = baseMsg({ media: { _: 'messageMediaEmpty' } });
        const c = mount(h(MessageItem as any, itemProps(m)));
        await new Promise((r) => setTimeout(r, 50));
        expect((c.textContent || '').trim().length).toBeGreaterThan(0);
        expect(c.textContent).toContain(t(S.MESSAGE_UNSUPPORTED));
    });

    test('plain text message never shows notice', async () => {
        const m = baseMsg({ message: 'hello there' });
        const c = mount(h(MessageBubble as any, {
            text: 'hello there', time: '12:44', out: false, status: 'read', messageId: 9002,
        }));
        await new Promise((r) => setTimeout(r, 50));
        expect(c.textContent).toContain('hello there');
        expect(c.textContent).not.toContain(t(S.MESSAGE_UNSUPPORTED));
    });
});

describe('media type utils', () => {
    test('getMediaType maps sticker/photo/video/audio/document/unknown', () => {
        expect(getMediaType(null)).toBe('none');
        expect(getMediaType({ _: 'messageMediaDice' })).toBe('dice');
        expect(getMediaType({ _: 'messageMediaPhoto', photo: { _: 'photo' } })).toBe('photo');
        expect(getMediaType({ _: 'messageMediaPhoto', photo: { _: 'photoEmpty' } })).toBe('none');
        expect(getMediaType({ _: 'messageMediaDocument', document: { _: 'document', mime_type: 'application/x-tgsticker', attributes: [] } })).toBe('sticker');
        expect(getMediaType({ _: 'messageMediaDocument', document: { _: 'document', mime_type: 'video/mp4', attributes: [{ _: 'documentAttributeVideo' }] } })).toBe('video');
        expect(getMediaType({ _: 'messageMediaDocument', document: { _: 'document', mime_type: 'audio/ogg', attributes: [] } })).toBe('audio');
        expect(getMediaType({ _: 'messageMediaDocument', document: { _: 'document', mime_type: 'application/pdf', attributes: [] } })).toBe('document');
        expect(getMediaType({ _: 'messageMediaEmpty' })).toBe('unknown');
        expect(getMediaType({ _: 'messageMediaWebPage' })).toBe('webpage');
    });

    test('mediaFallbackText prefers filename then label', () => {
        expect(mediaFallbackText(null)).toBe('');
        expect(mediaFallbackText({ _: 'messageMediaDocument', document: { file_name: 'a.zip' } })).toBe('a.zip');
        expect(mediaFallbackText({ _: 'messageMediaDocument', document: {} }, t(S.FILE_DEFAULT))).toBe(t(S.FILE_DEFAULT));
    });
});

describe('in-flow button notice', () => {
    const bubbleProps = (extra: any = {}) => ({
        text: 'hi', time: '12:44', out: false, status: 'read',
        messageId: 9001, ...extra,
    });

    test('no pill without notice', () => {
        const c = mount(h(MessageBubble as any, bubbleProps()));
        expect(c.querySelector('.tgui-btn-notice')).toBeNull();
        c.remove();
    });

    test('pill overlays inside bubble above pressed button', () => {
        const c = mount(h(MessageBubble as any, bubbleProps({
            buttonNotice: { messageId: 9001, text: 'Limit reached', version: 2, rel: { x: 150, y: 200, w: 100, h: 40 } },
        })));
        const el = c.querySelector('.tgui-btn-notice') as HTMLElement;
        expect(el).toBeTruthy();
        expect(el.textContent).toBe('Limit reached');
        expect(el.closest('.MessageBubble')).toBeTruthy();
        expect(el.style.top).toBe('192px');
        expect(el.parentNode).not.toBe(document.body);
        c.remove();
    });
});
