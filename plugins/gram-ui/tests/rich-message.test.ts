/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { MessageBubble } from '../dist/components/message-bubble.js';
import { normalizeReplyMarkup } from '../dist/components/inline-keyboard.js';
import { RichMessageView } from '../dist/components/rich-message.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const CHESS_RICH = {
    _: 'richMessage',
    flags: 0,
    blocks: [
        {
            _: 'pageBlockTable', flags: 4, compact: true,
            title: { _: 'textEmpty' },
            rows: [
                { _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', flags: 169, header: true, align_center: true, valign_middle: true, text: { _: 'textEmpty' } },
                    { _: 'pageTableCell', flags: 169, header: true, align_center: true, valign_middle: true, text: { _: 'textPlain', text: 'a' } },
                    { _: 'pageTableCell', flags: 169, header: true, align_center: true, valign_middle: true, text: { _: 'textPlain', text: 'b' } },
                    { _: 'pageTableCell', flags: 169, header: true, align_center: true, valign_middle: true, text: { _: 'textPlain', text: 'c' } },
                ] },
                { _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', flags: 168, align_center: true, valign_middle: true, text: { _: 'textButton', flags: 1, text: { _: 'textCustomEmoji', document_id: '1', alt: '♟' }, type: { _: 'inlineButtonTypeCallback', data: '703a73713a6137' }, style: { _: 'richButtonStyle' } } },
                    { _: 'pageTableCell', flags: 169, align_center: true, valign_middle: true, text: { _: 'textButton', flags: 1, text: { _: 'textCustomEmoji', document_id: '2', alt: '♙' }, type: { _: 'inlineButtonTypeCallback', data: '703a73713a6237' }, style: { _: 'richButtonStyle' } } },
                    { _: 'pageTableCell', flags: 169, align_center: true, valign_middle: true, text: { _: 'textEmpty' } },
                ] },
            ],
        },
        { _: 'pageBlockParagraph', text: { _: 'textBold', text: { _: 'textPlain', text: 'Tap a piece, then the square it goes to. ' } } },
        { _: 'pageBlockParagraph', text: [
            { _: 'textPlain', text: 'I answer as Black — ' },
            { _: 'textBold', text: { _: 'textPlain', text: 'Flip Board' } },
            { _: 'textPlain', text: ' if you would rather play the other side.' },
        ] },
        { _: 'pageBlockButtonRow', buttons: [
            { _: 'pageButton', text: { _: 'textPlain', text: 'Flip Board' }, type: { _: 'inlineButtonTypeUrl', url: 'https://example.org' } },
            { _: 'pageButton', text: { _: 'textPlain', text: 'Undo' }, type: { _: 'inlineButtonTypeCallback', data: 'dW5kbw==' } },
        ] },
    ],
};

const NEW_REPLY_MARKUP = {
    _: 'replyInlineMarkup',
    force_reply: true,
    rows: [
        { _: 'keyboardInlineButtonRow', buttons: [
            { _: 'keyboardInlineButton', text: 'Flip Board', type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
            { _: 'keyboardInlineButton', text: 'Open', type: { _: 'inlineButtonTypeUrl', url: 'https://x.io' } },
        ] },
    ],
};

describe('MessageBubble with layer-229 rich_message', () => {
    test('renders the board table, paragraph and buttons without throwing', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6181,
            richMessage: CHESS_RICH,
            richDocumentUrls: { 'emojipack-1': 'blob:ce1', 'emojipack-2': 'blob:ce2' },
        });
        expect(() => render(Comp, container)).not.toThrow();
        const table = container.querySelector('table.rich-table');
        expect(table).toBeTruthy();
        expect(container.textContent).toContain('Flip Board');
        expect(container.textContent).toContain('Tap a piece');
        expect(container.querySelector('strong')).toBeTruthy();
        expect(container.querySelectorAll('td, th').length).toBeGreaterThan(4);

        const imgs = container.querySelectorAll('img.rich-ce-img');
        expect(imgs.length).toBe(2);
        expect(imgs[0].getAttribute('src')).toBe('blob:ce1');
        expect(container.textContent).not.toContain('[textCustomEmoji]');
        const cellBtns = container.querySelectorAll('button.rich-cell-btn');
        expect(cellBtns.length).toBe(2);
    });

    test('callback button click dispatches tg-bot-callback', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6181,
            richMessage: CHESS_RICH,
            onRichButton: (data: string) => {
                (window as any).__lastCb = data;
            },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn'));
        const undo = btns.find((b) => (b.textContent || '').includes('Undo'))!;
        expect(undo).toBeTruthy();

        expect((undo.textContent || '').trim()).toBe('Undo');
        undo.click();
        expect((window as any).__lastCb).toBe('dW5kbw==');
    });
});

describe('normalizeReplyMarkup: layer-229 inline model', () => {
    test('keyboardInlineButton rows map to callback/url kinds', () => {
        const rows = normalizeReplyMarkup(NEW_REPLY_MARKUP)!;
        expect(rows.length).toBe(1);
        expect(rows[0][0]).toMatchObject({ text: 'Flip Board', kind: 'callback', data: 'ZmxpcA==' });
        expect(rows[0][1]).toMatchObject({ text: 'Open', kind: 'url', url: 'https://x.io' });
    });

    test('legacy keyboardButtonCallback still works', () => {
        const rows = normalizeReplyMarkup({
            _: 'replyInlineMarkup',
            rows: [{ buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'abc' }] }],
        })!;
        expect(rows[0][0]).toMatchObject({ text: 'Old', kind: 'callback', data: 'abc' });
    });

    test('non-markup returns null', () => {
        expect(normalizeReplyMarkup(null)).toBeNull();
        expect(normalizeReplyMarkup({})).toBeNull();
    });
});
