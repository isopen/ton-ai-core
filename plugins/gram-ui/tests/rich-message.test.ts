/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { MessageBubble } from '../dist/components/message-bubble.js';
import { buttonStyleClass, isInactiveButtonData } from '../dist/utils.js';
import { Slideshow } from '../dist/components/slideshow.js';
import { InlineKeyboard, normalizeReplyMarkup } from '../dist/components/inline-keyboard.js';
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

    test('table cell button click dispatches once, cell click dispatches once', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6181,
            richMessage: CHESS_RICH,
            richDocumentUrls: { 'emojipack-1': 'blob:ce1', 'emojipack-2': 'blob:ce2' },
            onRichButton: (data: string) => {
                seen.push(data);
            },
        });
        render(Comp, container);
        const cellBtn = container.querySelector('button.rich-cell-btn') as HTMLButtonElement;
        expect(cellBtn).toBeTruthy();
        cellBtn.click();
        expect(seen.length).toBe(1);
        expect(seen[0]).toBe('cDpzcTphNw==');
        const cell = cellBtn.closest('td') as HTMLElement;
        expect(cell).toBeTruthy();
        cell.click();
        expect(seen.length).toBe(2);
        expect(seen[0]).toBe(seen[1]);
    });

    test('legal move marker renders dot', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const dotRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable', compact: true,
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textCustomEmoji', document_id: '9', alt: '⬛' }, type: { _: 'inlineButtonTypeCallback', data: 'eA==' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6183,
            richMessage: dotRich,
            richDocumentUrls: {},
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.querySelectorAll('span.rich-ce-dot').length).toBe(1);
    });

    test('slideshow renders items and caption', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const slideRich = {
            _: 'richMessage',
            photos: [
                { _: 'photo', id: '11', sizes: [{ _: 'photoSize', type: 'y', w: 1280, h: 720, url: 'blob:slide1' }] },
                { _: 'photo', id: '12', sizes: [{ _: 'photoSize', type: 'y', w: 1280, h: 720, url: 'blob:slide2' }] },
            ],
            blocks: [{
                _: 'pageBlockSlideshow',
                items: [
                    { _: 'pageBlockPhoto', photo_id: '11', caption: { _: 'pageCaption', text: { _: 'textEmpty' }, credit: { _: 'textEmpty' } } },
                    { _: 'pageBlockPhoto', photo_id: '12', caption: { _: 'pageCaption', text: { _: 'textEmpty' }, credit: { _: 'textEmpty' } } },
                ],
                caption: { _: 'pageCaption', text: { _: 'textPlain', text: 'Trip album' }, credit: { _: 'textEmpty' } },
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6184,
            richMessage: slideRich,
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.querySelectorAll('div.rich-slideshow').length).toBe(1);
        expect(container.querySelectorAll('div.rich-slideshow-item').length).toBe(2);
        expect(container.querySelectorAll('button.rich-slideshow-edge').length).toBe(2);
        expect(container.querySelectorAll('div.rich-slideshow-frame').length).toBe(1);
        expect(container.querySelectorAll('div.rich-slideshow-dots_row').length).toBe(1);
        expect(container.querySelectorAll('div.rich-slideshow-dots_overlay').length).toBe(0);
        expect(container.querySelectorAll('button.rich-slideshow-dot').length).toBe(2);
        expect(container.textContent).toContain('Trip album');
        expect(container.textContent).not.toContain('[block: pageBlockSlideshow]');
        const frame = container.querySelector('div.rich-slideshow-frame') as HTMLElement;
        expect(frame.style.maxWidth).toBe('');
        const slideBoxes = Array.from(container.querySelectorAll('div.rich-slideshow-item div.TelegramImage')) as HTMLElement[];
        expect(slideBoxes.length).toBe(2);
        for (const box of slideBoxes) {
          expect(box.style.width).toBe('100%');
          expect(box.style.maxWidth).toBe('480px');
        }
        const dots = Array.from(container.querySelectorAll('button.rich-slideshow-dot'));
        expect(dots[0].className).toContain('rich-slideshow-dot_active');
        (dots[1] as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 50));
        const dotsAfter = Array.from(container.querySelectorAll('button.rich-slideshow-dot'));
        expect(dotsAfter[1].className).toContain('rich-slideshow-dot_active');
        expect(dotsAfter[0].className).not.toContain('rich-slideshow-dot_active');
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

    test('rapid double click on Undo dispatches twice, clicks never swallowed', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6181,
            richMessage: CHESS_RICH,
            onRichButton: (data: string) => {
                seen.push(data);
            },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn'));
        const undo = btns.find((b) => (b.textContent || '').includes('Undo'))! as HTMLButtonElement;
        expect(undo).toBeTruthy();
        undo.click();
        undo.click();
        expect(seen).toEqual(['dW5kbw==', 'dW5kbw==']);
    });

    test('flip and reset buttons dispatch their own payloads exactly once', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const resetHex = Buffer.from('DPYI:reset', 'utf-8').toString('hex');
        const resetB64 = Buffer.from('DPYI:reset', 'utf-8').toString('base64');
        const rich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow',
                buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Flip Board' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Undo' }, type: { _: 'inlineButtonTypeCallback', data: 'dW5kbw==' } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Restart' }, type: { _: 'inlineButtonTypeCallback', data: resetHex } },
                ],
            }],
        };
        const seen: string[] = [];
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6182,
            richMessage: rich,
            onRichButton: (data: string) => {
                seen.push(data);
            },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(3);
        const byText = (t: string) => btns.find((b) => (b.textContent || '').includes(t))!;
        byText('Flip Board').click();
        expect(seen).toEqual(['ZmxpcA==']);
        byText('Restart').click();
        expect(seen).toEqual(['ZmxpcA==', resetB64]);
        byText('Undo').click();
        expect(seen).toEqual(['ZmxpcA==', resetB64, 'dW5kbw==']);
    });
});

describe('bot button styling from server', () => {
    test('buttonStyleClass maps TL flags', () => {
        expect(buttonStyleClass(undefined)).toBe('');
        expect(buttonStyleClass(null)).toBe('');
        expect(buttonStyleClass('richButtonStyle')).toBe('');
        expect(buttonStyleClass({})).toBe('');
        expect(buttonStyleClass({ _: 'richButtonStyle', bg_primary: true })).toBe(' is-primary');
        expect(buttonStyleClass({ _: 'richButtonStyle', bg_danger: true })).toBe(' is-danger');
        expect(buttonStyleClass({ _: 'richButtonStyle', bg_success: true })).toBe(' is-success');
        expect(buttonStyleClass({ _: 'richButtonStyle', link: true })).toBe(' is-link');
        expect(buttonStyleClass({ _: 'keyboardButtonStyle', bg_danger: true })).toBe(' is-danger');
        expect(buttonStyleClass({ _: 'richButtonStyle', bg_danger: true, bg_primary: true })).toBe(' is-danger');
        expect(buttonStyleClass({ _: 'richButtonStyle', bg_success: true, link: true })).toBe(' is-success is-link');
    });

    test('button row applies server bg and link classes', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const rich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow',
                buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Go' }, type: { _: 'inlineButtonTypeCallback', data: 'Z28=' }, style: { _: 'richButtonStyle', bg_primary: true } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Stop' }, type: { _: 'inlineButtonTypeCallback', data: 'c3RvcA==' }, style: { _: 'richButtonStyle', bg_danger: true } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'More' }, type: { _: 'inlineButtonTypeUrl', url: 'https://x.io' }, style: { _: 'richButtonStyle', link: true } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Plain' }, type: { _: 'inlineButtonTypeCallback', data: 'cA==' } },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '', time: '12:44', out: false, status: 'read',
            messageId: 6195, richMessage: rich,
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(4);
        const cls = (t: string) => btns.find((b) => (b.textContent || '').includes(t))!.className;
        expect(cls('Go')).toContain('is-primary');
        expect(cls('Stop')).toContain('is-danger');
        expect(cls('More')).toContain('is-link');
        expect(cls('Plain')).not.toContain('is-');
    });

    test('table cell button applies server bg class', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const rich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable',
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'A' }, type: { _: 'inlineButtonTypeCallback', data: 'Z28=' }, style: { _: 'richButtonStyle', bg_success: true } } },
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'B' }, type: { _: 'inlineButtonTypeCallback', data: 'Z28=' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '', time: '12:44', out: false, status: 'read',
            messageId: 6196, richMessage: rich,
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-cell-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].className).toContain('is-success');
        expect(btns[1].className).not.toContain('is-');
    });

    test('reply keyboard carries server style to rendered buttons', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(MessageBubble, {
            text: 'pick', time: '12:44', out: false, status: 'read',
            messageId: 6197,
            replyMarkup: {
                _: 'replyInlineMarkup',
                rows: [{ _: 'keyboardInlineButtonRow', buttons: [
                    { _: 'keyboardInlineButton', text: 'Yes', type: { _: 'inlineButtonTypeCallback', data: 'eWVz' }, style: { _: 'keyboardButtonStyle', bg_success: true } },
                    { _: 'keyboardInlineButton', text: 'No', type: { _: 'inlineButtonTypeCallback', data: 'bm8=' } },
                ] }],
            },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.MessageBubble__kb-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].className).toContain('is-success');
        expect(btns[1].className).not.toContain('is-');
    });
});

describe('Slideshow default bar mode', () => {
    test('bar buttons and dots navigate', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(Slideshow, {
            count: 3,
            renderItem: (i: number) => ({ type: 'span', props: {}, children: [{ type: 'TEXT_NODE', props: { nodeValue: 's' + i }, children: [], key: null }], key: 'ss' + i }),
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.querySelectorAll('button.rich-slideshow-btn').length).toBe(2);
        expect(container.querySelectorAll('button.rich-slideshow-dot').length).toBe(3);
        expect(container.querySelectorAll('div.rich-slideshow-item').length).toBe(3);
        const next = container.querySelector('button.rich-slideshow-btn[aria-label="Next"]') as HTMLButtonElement;
        next.click();
        await new Promise((r) => setTimeout(r, 50));
        const dots = Array.from(container.querySelectorAll('button.rich-slideshow-dot'));
        expect(dots[1].className).toContain('rich-slideshow-dot_active');
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
    test('icon-only buttons with data or url are kept, junk dropped', () => {
        const rows = normalizeReplyMarkup({
            _: 'replyInlineMarkup',
            rows: [{ buttons: [
                { _: 'keyboardButtonCallback', text: '', data: 'eA==' },
                { _: 'keyboardButtonUrl', text: '', url: 'https://x.io' },
                null,
                { _: 'keyboardButtonCallback', text: '' },
            ] }],
        })!;
        expect(rows.length).toBe(1);
        expect(rows[0].length).toBe(2);
        expect(rows[0][0]).toMatchObject({ text: '', kind: 'callback', data: 'eA==' });
        expect(rows[0][1]).toMatchObject({ text: '', kind: 'url', url: 'https://x.io' });
    });
});

describe('MessageBubble list with block items', () => {
    test('pageListItemBlocks renders nested blocks incl photo', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const listRich = {
            _: 'richMessage',
            photos: [
                { _: 'photo', id: '21', sizes: [{ _: 'photoSize', type: 'y', w: 640, h: 480, url: 'blob:list1' }] },
            ],
            blocks: [{
                _: 'pageBlockList',
                items: [
                    { _: 'pageListItemText', text: { _: 'textPlain', text: 'First point' } },
                    { _: 'pageListItemBlocks', blocks: [
                        { _: 'pageBlockParagraph', text: { _: 'textPlain', text: 'Second point' } },
                        { _: 'pageBlockPhoto', photo_id: '21', caption: { _: 'pageCaption', text: { _: 'textEmpty' }, credit: { _: 'textEmpty' } } },
                    ] },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6185,
            richMessage: listRich,
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.querySelectorAll('li.rich-list-item').length).toBe(2);
        expect(container.textContent).toContain('First point');
        expect(container.textContent).toContain('Second point');
        expect(container.querySelectorAll('li.rich-list-item div.TelegramImage').length).toBe(1);
    });
});

describe('MessageBubble rich plain unicode emoji', () => {
    test('emoji without sticker doc renders as text, not gap', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const arrowRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockParagraph',
                text: { _: 'textPlain', text: '🔻 Down arrow title' },
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6186,
            richMessage: arrowRich,
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.textContent).toContain('🔻');
        expect(container.textContent).toContain('Down arrow title');
    });
});

describe('MessageBubble standalone rich photo', () => {
    test('cover photo fills bubble width', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const coverRich = {
            _: 'richMessage',
            photos: [
                { _: 'photo', id: '31', sizes: [{ _: 'photoSize', type: 'y', w: 1280, h: 640, url: 'blob:cover1' }] },
            ],
            blocks: [{
                _: 'pageBlockPhoto',
                photo_id: '31',
                caption: { _: 'pageCaption', text: { _: 'textEmpty' }, credit: { _: 'textEmpty' } },
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6187,
            richMessage: coverRich,
        });
        expect(() => render(Comp, container)).not.toThrow();
        const box = container.querySelector('div.rich-photo div.TelegramImage') as HTMLElement;
        expect(box).toBeTruthy();
        expect(box.style.width).toBe('100%');
        expect(box.style.maxWidth).toBe('480px');
    });
});

describe('MessageBubble custom emoji without doc id', () => {
    test('renders nothing and never looks up undefined key', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const brokenRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockParagraph',
                text: { _: 'textConcat', texts: [
                    { _: 'textPlain', text: 'Lead ' },
                    { _: 'textCustomEmoji', alt: '🤴' },
                ] },
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6188,
            richMessage: brokenRich,
            richDocumentUrls: {},
        });
        expect(() => render(Comp, container)).not.toThrow();
        expect(container.textContent).toContain('Lead');
        expect(container.textContent).not.toContain('[textCustomEmoji]');
    });
});

describe('MessageBubble board cell flip-flop', () => {
    const FILLER = { _: 'textCustomEmoji', document_id: '90', alt: '🫣' };
    const cellRich = (kind: 'piece' | 'filler', urls: Record<string, string>) => ({
        _: 'richMessage',
        blocks: [{
            _: 'pageBlockTable',
            rows: [{ _: 'pageTableRow', cells: [
                { _: 'pageTableCell', text: kind === 'piece'
                    ? { _: 'textButton', text: { _: 'textCustomEmoji', document_id: '77', alt: '♟' }, type: { _: 'inlineButtonTypeCallback', data: 'eA==' } }
                    : { _: 'textButton', text: FILLER, type: { _: 'inlineButtonTypeCallback', data: 'bm8=' } } },
            ] }],
        }],
    });
    test('piece survives filler round-trip and late url arrival', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let setBoard: (s: { kind: 'piece' | 'filler'; urls: Record<string, string> }) => void = () => {};
        const Wrapper: any = () => {
            const [s, setS] = useState({ kind: 'piece' as 'piece' | 'filler', urls: { 'emojipack-77': 'blob:ce77' } });
            setBoard = setS;
            return h(MessageBubble, {
                text: '',
                time: '12:44',
                out: false,
                status: 'read',
                messageId: 6190,
                richMessage: cellRich(s.kind, s.urls),
                richDocumentUrls: s.urls,
            });
        };
        const show = async (kind: 'piece' | 'filler', urls: Record<string, string>) => {
            setBoard({ kind, urls });
            await new Promise((r) => setTimeout(r, 50));
        };
        render(Wrapper, container);
        await new Promise((r) => setTimeout(r, 50));
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(1);
        await show('filler', { 'emojipack-77': 'blob:ce77' });
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(0);
        expect(container.querySelectorAll('button.rich-cell-btn').length).toBe(1);
        await show('piece', {});
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(0);
        await show('piece', { 'emojipack-77': 'blob:ce77' });
        const imgs = container.querySelectorAll('img.rich-ce-img');
        expect(imgs.length).toBe(1);
        expect(imgs[0].getAttribute('src')).toBe('blob:ce77');
    });
});

describe('MessageBubble board multi-cell patch', () => {
    const F = { _: 'textCustomEmoji', document_id: '90', alt: '🫣' };
    const P = (doc: string, alt: string) => ({ _: 'textButton', text: { _: 'textCustomEmoji', document_id: doc, alt }, type: { _: 'inlineButtonTypeCallback', data: 'eA==' } });
    const boardRich = (cells: any[]) => ({
        _: 'richMessage',
        blocks: [{
            _: 'pageBlockTable',
            rows: [{ _: 'pageTableRow', cells: cells.map((t) => ({ _: 'pageTableCell', text: t })) }],
        }],
    });
    const urls = { 'emojipack-77': 'blob:ce77', 'emojipack-78': 'blob:ce78' };
    test('simultaneous multi-cell flip keeps every piece', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let setBoard: (s: { cells: any[] }) => void = () => {};
        const Wrapper: any = () => {
            const [s, setS] = useState({ cells: [P('77', '♟'), F, P('78', '♞')] });
            setBoard = setS;
            return h(MessageBubble, {
                text: '',
                time: '12:44',
                out: false,
                status: 'read',
                messageId: 6191,
                richMessage: boardRich(s.cells),
                richDocumentUrls: urls,
            });
        };
        const show = async (cells: any[]) => {
            setBoard({ cells });
            await new Promise((r) => setTimeout(r, 50));
        };
        render(Wrapper, container);
        await new Promise((r) => setTimeout(r, 50));
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(2);
        await show([F, P('77', '♟'), F]);
        await show([P('77', '♟'), F, F]);
        const imgs = container.querySelectorAll('img.rich-ce-img');
        expect(imgs.length).toBe(1);
        expect(imgs[0].getAttribute('src')).toBe('blob:ce77');
        expect(container.querySelectorAll('td.rich-cell').length).toBe(3);
    });
});

describe('inactive bot buttons (noop data)', () => {
    test('isInactiveButtonData decodes all encodings', () => {
        expect(isInactiveButtonData('bm9vcA==')).toBe(true);
        expect(isInactiveButtonData('noop')).toBe(true);
        expect(isInactiveButtonData('6e6f6f70')).toBe(true);
        expect(isInactiveButtonData('b64:bm9vcA==')).toBe(true);
        expect(isInactiveButtonData('bm9vcA')).toBe(true);
        expect(isInactiveButtonData('DPYIfkDwUcr6:no')).toBe(true);
        expect(isInactiveButtonData('game:noop')).toBe(true);
        expect(isInactiveButtonData('game:none')).toBe(true);
        expect(isInactiveButtonData('no')).toBe(false);
        expect(isInactiveButtonData('yes')).toBe(false);
        expect(isInactiveButtonData('p:sq:a7')).toBe(false);
        expect(isInactiveButtonData('sq:c2')).toBe(false);
        expect(isInactiveButtonData('dW5kbw==')).toBe(false);
        expect(isInactiveButtonData('cDpzcTphNw==')).toBe(false);
        expect(isInactiveButtonData('eA==')).toBe(false);
        expect(isInactiveButtonData('ZmxpcA==')).toBe(false);
        expect(isInactiveButtonData('')).toBe(false);
        expect(isInactiveButtonData(null)).toBe(false);
        expect(isInactiveButtonData(undefined)).toBe(false);
    });

    test('noop ButtonRow button is disabled and never dispatches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const noopRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow', buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Dead' }, type: { _: 'inlineButtonTypeCallback', data: 'bm9vcA==' } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Live' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6201,
            richMessage: noopRich,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].disabled).toBe(true);
        expect(btns[0].className).toContain('is-inactive');
        expect(btns[1].disabled).toBe(false);
        expect(btns[1].className).not.toContain('is-inactive');
        btns[0].click();
        expect(seen).toEqual([]);
        btns[1].click();
        expect(seen).toEqual(['ZmxpcA==']);
    });

    test('noop table cell is not clickable and never dispatches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const noopTable = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable', compact: true,
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'x' }, type: { _: 'inlineButtonTypeCallback', data: 'bm9vcA==' } } },
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'y' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6202,
            richMessage: noopTable,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const cells = Array.from(container.querySelectorAll('td.rich-cell')) as HTMLElement[];
        expect(cells.length).toBe(2);
        expect(cells[0].className).toContain('rich-cell_inactive');
        expect(cells[0].className).not.toContain('rich-cell_clickable');
        expect(cells[1].className).toContain('rich-cell_clickable');
        cells[0].click();
        expect(seen).toEqual([]);
        cells[1].click();
        expect(seen).toEqual(['ZmxpcA==']);
    });

    test('noop inline keyboard button is disabled and never fires onButton', () => {        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: any[] = [];
        const Comp: any = () => h(InlineKeyboard, {
            rows: [[
                { text: 'Dead', kind: 'callback', data: 'bm9vcA==' },
                { text: 'Live', kind: 'callback', data: 'ZmxpcA==' },
            ]],
            onButton: (b: any) => { seen.push(b); },
            documentUrls: {},
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.MessageBubble__kb-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].disabled).toBe(true);
        expect(btns[0].className).toContain('is-inactive');
        btns[0].click();
        expect(seen).toEqual([]);
        btns[1].click();
        expect(seen.length).toBe(1);
        expect(seen[0].data).toBe('ZmxpcA==');
    });
});

describe('learned inactive buttons (server rejection)', () => {
    const markedUrls = {};
    const marked = (mid: number, data: string) => ({ [mid + '\n' + data]: true }) as Record<string, true>;

    test('marked ButtonRow button is disabled and never dispatches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const rowRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow', buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Undo' }, type: { _: 'inlineButtonTypeCallback', data: 'dW5kbw==' } },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6301,
            richMessage: rowRich,
            richDocumentUrls: markedUrls,
            inactiveButtons: marked(6301, 'dW5kbw=='),
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const btn = container.querySelector('button.rich-btn') as HTMLButtonElement;
        expect(btn).toBeTruthy();
        expect(btn.disabled).toBe(true);
        expect(btn.className).toContain('is-inactive');
        btn.click();
        expect(seen).toEqual([]);
    });

    test('marked table cell loses clickability', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const cellTable = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable', compact: true,
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'u' }, type: { _: 'inlineButtonTypeCallback', data: 'dW5kbw==' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6302,
            richMessage: cellTable,
            richDocumentUrls: markedUrls,
            inactiveButtons: marked(6302, 'dW5kbw=='),
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const cell = container.querySelector('td.rich-cell') as HTMLElement;
        expect(cell).toBeTruthy();
        expect(cell.className).toContain('rich-cell_inactive');
        expect(cell.className).not.toContain('rich-cell_clickable');
        cell.click();
        expect(seen).toEqual([]);
    });

    test('marked inline keyboard button is disabled', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: any[] = [];
        const Comp: any = () => h(InlineKeyboard, {
            rows: [[{ text: 'Undo', kind: 'callback', data: 'dW5kbw==' }]],
            messageId: 6303,
            inactiveButtons: marked(6303, 'dW5kbw=='),
            onButton: (b: any) => { seen.push(b); },
            documentUrls: {},
        });
        render(Comp, container);
        const btn = container.querySelector('button.MessageBubble__kb-btn') as HTMLButtonElement;
        expect(btn).toBeTruthy();
        expect(btn.disabled).toBe(true);
        btn.click();
        expect(seen).toEqual([]);
    });

    test('unmarked buttons still dispatch', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const Comp: any = () => h(InlineKeyboard, {
            rows: [[{ text: 'Undo', kind: 'callback', data: 'dW5kbw==' }]],
            messageId: 6304,
            inactiveButtons: marked(6303, 'dW5kbw=='),
            onButton: (b: any) => { seen.push(b); },
            documentUrls: {},
        });
        render(Comp, container);
        const btn = container.querySelector('button.MessageBubble__kb-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        btn.click();
        expect(seen.length).toBe(1);
    });
});

describe('bot-flagged inactive buttons (gameId:no)', () => {
    test('namespaced no-action ButtonRow button is disabled from first paint', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const rowRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow', buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Undo' }, type: { _: 'inlineButtonTypeCallback', data: 'DPYIfkDwUcr6:no' } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Flip' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6401,
            richMessage: rowRich,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].disabled).toBe(true);
        expect(btns[0].className).toContain('is-inactive');
        expect(btns[1].disabled).toBe(false);
        btns[0].click();
        expect(seen).toEqual([]);
        btns[1].click();
        expect(seen).toEqual(['ZmxpcA==']);
    });

    test('piece cells never dim while empty cells do', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const boardTable = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable', compact: true,
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'empty' }, type: { _: 'inlineButtonTypeCallback', data: 'DPYIfkDwUcr6:no' } } },
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'piece' }, type: { _: 'inlineButtonTypeCallback', data: 'cDpzcTphNw==' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6402,
            richMessage: boardTable,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const cells = Array.from(container.querySelectorAll('td.rich-cell')) as HTMLElement[];
        expect(cells.length).toBe(2);
        expect(cells[0].className).toContain('rich-cell_inactive');
        expect(cells[0].className).not.toContain('rich-cell_clickable');
        expect(cells[1].className).toContain('rich-cell_clickable');
        expect(cells[1].className).not.toContain('rich-cell_inactive');
        cells[0].click();
        cells[1].click();
        expect(seen).toEqual(['cDpzcTphNw==']);
    });
});

describe('protocol disabled buttons (inlineButtonTypeDisabled)', () => {
    test('normalizeReplyMarkup keeps disabled kind', () => {
        const rows = normalizeReplyMarkup({
            _: 'replyInlineMarkup',
            rows: [{ _: 'keyboardInlineButtonRow', buttons: [
                { _: 'keyboardInlineButton', text: 'Undo', type: { _: 'inlineButtonTypeDisabled' } },
                { _: 'keyboardInlineButton', text: 'Flip', type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
            ] }],
        });
        expect(rows).toBeTruthy();
        expect(rows![0][0].kind).toBe('disabled');
        expect(rows![0][0].data).toBeUndefined();
        expect(rows![0][1].kind).toBe('callback');
    });

    test('disabled inline keyboard button renders dimmed and never fires', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: any[] = [];
        const Comp: any = () => h(InlineKeyboard, {
            rows: [[
                { text: 'Undo', kind: 'disabled' },
                { text: 'Flip', kind: 'callback', data: 'ZmxpcA==' },
            ]],
            messageId: 6501,
            onButton: (b: any) => { seen.push(b); },
            documentUrls: {},
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.MessageBubble__kb-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].disabled).toBe(true);
        expect(btns[0].className).toContain('is-inactive');
        btns[0].click();
        expect(seen).toEqual([]);
        btns[1].click();
        expect(seen.length).toBe(1);
    });

    test('disabled ButtonRow button renders dimmed and never dispatches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const rowRich = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockButtonRow', buttons: [
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Undo' }, type: { _: 'inlineButtonTypeDisabled' } },
                    { _: 'pageButton', text: { _: 'textPlain', text: 'Flip' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } },
                ],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6502,
            richMessage: rowRich,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const btns = Array.from(container.querySelectorAll('button.rich-btn')) as HTMLButtonElement[];
        expect(btns.length).toBe(2);
        expect(btns[0].disabled).toBe(true);
        expect(btns[0].className).toContain('is-inactive');
        btns[0].click();
        expect(seen).toEqual([]);
        btns[1].click();
        expect(seen).toEqual(['ZmxpcA==']);
    });

    test('disabled table cell is not clickable and never dispatches', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const seen: string[] = [];
        const disTable = {
            _: 'richMessage',
            blocks: [{
                _: 'pageBlockTable', compact: true,
                rows: [{ _: 'pageTableRow', cells: [
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'u' }, type: { _: 'inlineButtonTypeDisabled' } } },
                    { _: 'pageTableCell', text: { _: 'textButton', text: { _: 'textPlain', text: 'f' }, type: { _: 'inlineButtonTypeCallback', data: 'ZmxpcA==' } } },
                ] }],
            }],
        };
        const Comp: any = () => h(MessageBubble, {
            text: '',
            time: '12:44',
            out: false,
            status: 'read',
            messageId: 6503,
            richMessage: disTable,
            richDocumentUrls: {},
            onRichButton: (data: string) => { seen.push(data); },
        });
        render(Comp, container);
        const cells = Array.from(container.querySelectorAll('td.rich-cell')) as HTMLElement[];
        expect(cells.length).toBe(2);
        expect(cells[0].className).toContain('rich-cell_inactive');
        expect(cells[0].className).not.toContain('rich-cell_clickable');
        expect(cells[1].className).toContain('rich-cell_clickable');
        cells[0].click();
        expect(seen).toEqual([]);
        cells[1].click();
        expect(seen).toEqual(['ZmxpcA==']);
    });
});
