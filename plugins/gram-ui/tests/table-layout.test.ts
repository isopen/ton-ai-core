/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { MessageBubble } from '../dist/components/message-bubble.js';

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

const FILLER = { _: 'textCustomEmoji', document_id: '90', alt: '🫣' };
const DOT = { _: 'textCustomEmoji', document_id: '91', alt: '⬛' };
const piece = (doc: string, alt: string) => ({
    _: 'textButton',
    text: { _: 'textCustomEmoji', document_id: doc, alt },
    type: { _: 'inlineButtonTypeCallback', data: 'eA==' },
});
const fillerCell = () => ({
    _: 'textButton', text: FILLER,
    type: { _: 'inlineButtonTypeCallback', data: 'bm8=' },
});
const dotCell = () => ({
    _: 'textButton', text: DOT,
    type: { _: 'inlineButtonTypeCallback', data: 'eA==' },
});
const headerCell = (t: string) => ({ _: 'pageTableCell', flags: 169, header: true, text: { _: 'textPlain', text: t } });
const dataCell = (t: any) => ({ _: 'pageTableCell', text: t });

const boardOf = (rows: any[][]) => ({
    _: 'richMessage',
    blocks: [{
        _: 'pageBlockTable', compact: true,
        rows: rows.map((cells, ri) => ({
            _: 'pageTableRow',
            cells: cells.map((c, ci) => ri === 0 || ci === 0
                ? headerCell(typeof c === 'string' ? c : '?')
                : dataCell(c)),
        })),
    }],
});

const URLS = { 'emojipack-77': 'blob:ce77', 'emojipack-78': 'blob:ce78', 'emojipack-90': 'blob:ce90' };

function mountBoard(initial: any[][]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let setBoard: (cells: any[][]) => void = () => {};
    const Wrapper: any = () => {
        const [cells, setCells] = useState(initial);
        setBoard = setCells;
        return h(MessageBubble, {
            text: '', time: '12:44', out: false, status: 'read',
            messageId: 6500, richMessage: boardOf(cells), richDocumentUrls: URLS,
        });
    };
    render(Wrapper, container);
    return { container, show: async (cells: any[][]) => { setBoard(cells); await new Promise((r) => setTimeout(r, 50)); } };
}

const OPENING = [
    ['', 'a', 'b', 'c'],
    ['8', piece('77', '♜'), fillerCell(), dotCell()],
    ['7', fillerCell(), piece('78', '♞'), fillerCell()],
    ['6', fillerCell(), fillerCell(), fillerCell()],
];

const AFTER_MOVE = [
    ['', 'a', 'b', 'c'],
    ['8', fillerCell(), fillerCell(), dotCell()],
    ['7', fillerCell(), piece('78', '♞'), fillerCell()],
    ['6', piece('77', '♜'), fillerCell(), fillerCell()],
];

describe('rich table structure', () => {
    test('headers, pieces, dots and fillers render', async () => {
        const { container } = mountBoard(OPENING);
        await new Promise((r) => setTimeout(r, 50));
        expect(container.querySelectorAll('table.rich-table').length).toBe(1);
        expect(container.querySelectorAll('th.rich-cell').length).toBe(7);
        expect(container.querySelectorAll('td.rich-cell').length).toBe(9);
        expect(container.querySelectorAll('button.rich-cell-btn').length).toBe(9);
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(2);
        expect(container.querySelectorAll('span.rich-ce-dot').length).toBe(1);
        expect(container.textContent).toContain('a');
    });

    test('move keeps table shape, dots survive, buttons keep working', async () => {
        const seen: string[] = [];
        const container = document.createElement('div');
        document.body.appendChild(container);
        let setBoard: (cells: any[][]) => void = () => {};
        const Wrapper: any = () => {
            const [cells, setCells] = useState(OPENING);
            setBoard = setCells;
            return h(MessageBubble, {
                text: '', time: '12:44', out: false, status: 'read',
                messageId: 6501, richMessage: boardOf(cells), richDocumentUrls: URLS,
                onRichButton: (data: string) => { seen.push(data); },
            });
        };
        render(Wrapper, container);
        await new Promise((r) => setTimeout(r, 50));
        setBoard(AFTER_MOVE);
        await new Promise((r) => setTimeout(r, 50));
        expect(container.querySelectorAll('td.rich-cell').length).toBe(9);
        expect(container.querySelectorAll('button.rich-cell-btn').length).toBe(9);
        expect(container.querySelectorAll('span.rich-ce-dot').length).toBe(1);
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(2);
        const btns = Array.from(container.querySelectorAll('button.rich-cell-btn')) as HTMLButtonElement[];
        btns[0].click();
        expect(seen.length).toBe(1);
    });

    test('undo round-trip restores piece cell count', async () => {
        const { container, show } = mountBoard(OPENING);
        await new Promise((r) => setTimeout(r, 50));
        await show(AFTER_MOVE);
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(2);
        await show(OPENING);
        expect(container.querySelectorAll('img.rich-ce-img').length).toBe(2);
        expect(container.querySelectorAll('td.rich-cell').length).toBe(9);
        expect(container.querySelectorAll('span.rich-ce-dot').length).toBe(1);
    });
});

describe('rich table size stability css', () => {
    const cssPath = path.join(__dirname, '..', 'src', 'styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const tableBlock = (css.match(/\.rich-table\s*\{[^}]*\}/) || [''])[0];
    const cellBlock = (css.match(/\.rich-table\s+\.rich-cell\s*\{[^}]*\}/) || [''])[0];

    test('table uses fixed layout so columns never collapse', () => {
        expect(tableBlock).toContain('table-layout: fixed');
        expect(tableBlock).toContain('width: 100%');
    });

    test('cells pin height so rows never jump on piece moves', () => {
        expect(cellBlock).toMatch(/height:\s*\d+px/);
    });

    test('cell buttons are block-level so no inline strut inflates rows', () => {
        const btnBlock = (css.match(/\.rich-cell-btn\s*\{[^}]*\}/) || [''])[0];
        expect(btnBlock).toContain('display: flex');
        expect(btnBlock).not.toContain('inline-flex');
    });
});
