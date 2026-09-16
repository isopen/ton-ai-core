/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { SendInput, serializeInput, insertInputText, insertInputEmoji, refreshEmojiPreviews } from '../dist/components/send-input.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountInput(props: any = {}): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(SendInput as any, { dispatch: (() => {}) as any, onEmojiToggle: () => {}, documentUrls: {}, ...props });
    render(Probe, container);
    return container;
}

function editOf(c: HTMLElement): HTMLDivElement {
    return c.querySelector('#tg-msg-input') as HTMLDivElement;
}

describe('rich input serialization', () => {
    test('plain text has no entities', () => {
        const root = document.createElement('div');
        root.textContent = 'hello';
        expect(serializeInput(root)).toEqual({ text: 'hello', entities: [] });
    });

    test('emoji span yields utf16 offsets', () => {
        const root = document.createElement('div');
        root.appendChild(document.createTextNode('hi 👍 '));
        const span = document.createElement('span');
        span.setAttribute('data-doc-id', '9001');
        span.setAttribute('data-alt', '❤');
        root.appendChild(span);
        root.appendChild(document.createTextNode(' ok'));
        const out = serializeInput(root);
        expect(out.text).toBe('hi 👍 ❤ ok');
        expect(out.entities).toEqual([{ offset: 6, length: 1, document_id: '9001' }]);
    });

    test('span without doc id falls back to text', () => {
        const root = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = 'x';
        root.appendChild(span);
        expect(serializeInput(root)).toEqual({ text: 'x', entities: [] });
    });
});

describe('rich chat input', () => {
    test('tg-insert-emoji adds non-editable span with preview', async () => {
        const c = mountInput();
        await new Promise((r) => setTimeout(r, 20));
        window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId: '9001', alt: '❤' } }));
        await new Promise((r) => setTimeout(r, 40));
        const span = editOf(c).querySelector('span.ci-emoji') as HTMLElement | null;
        expect(span).not.toBeNull();
        expect(span!.getAttribute('data-doc-id')).toBe('9001');
        expect(span!.getAttribute('data-alt')).toBe('❤');
        expect(span!.getAttribute('contenteditable')).toBe('false');
        document.body.removeChild(c);
    });

    test('emoji-only content enables send with entities', async () => {
        const sent: any[] = [];
        const onMsg = (e: Event) => { sent.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-message', onMsg);
        try {
            const c = mountInput();
            await new Promise((r) => setTimeout(r, 20));
            window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId: '9001', alt: '❤' } }));
            await new Promise((r) => setTimeout(r, 40));
            const btn = c.querySelector('#tg-send-msg-btn') as HTMLElement;
            expect(btn.getAttribute('data-state')).toBe('active');
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));
            expect(sent.length).toBe(1);
            expect(sent[0].text).toBe('❤');
            expect(sent[0].entities).toEqual([{ offset: 0, length: 1, document_id: '9001' }]);
            expect(editOf(c).textContent).toBe('');
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-send-message', onMsg);
        }
    });

    test('mixed text and emoji keep correct offsets', async () => {
        const sent: any[] = [];
        const onMsg = (e: Event) => { sent.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-message', onMsg);
        try {
            const c = mountInput();
            await new Promise((r) => setTimeout(r, 20));
            window.dispatchEvent(new CustomEvent('tg-insert-text', { detail: { text: 'hey ' } }));
            const sel = window.getSelection();
            sel?.selectAllChildren(editOf(c));
            sel?.collapseToEnd();
            window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId: '9002', alt: '👍' } }));
            await new Promise((r) => setTimeout(r, 40));
            (c.querySelector('#tg-send-msg-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));
            expect(sent.length).toBe(1);
            expect(sent[0].text).toBe('hey 👍');
            expect(sent[0].entities).toEqual([{ offset: 4, length: 2, document_id: '9002' }]);
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-send-message', onMsg);
        }
    });

    test('inserted emoji renders animated preview when url arrives', async () => {
        const c = mountInput({ documentUrls: { 'emojipack-9001': 'blob:prev1' } });
        await new Promise((r) => setTimeout(r, 20));
        window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: '9001', url: 'blob:prev1', kind: 'img' } }));
        window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId: '9001', alt: '❤' } }));
        await new Promise((r) => setTimeout(r, 80));
        const span = editOf(c).querySelector('span.ci-emoji') as HTMLElement | null;
        expect(span).not.toBeNull();
        const img = span!.querySelector('img[src="blob:prev1"]') as HTMLElement | null;
        expect(img).not.toBeNull();
        document.body.removeChild(c);
    });

    test('preview upgrades when url arrives after insert', async () => {
        const c = mountInput({ documentUrls: {} });
        await new Promise((r) => setTimeout(r, 20));
        window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId: '9002', alt: '👍' } }));
        await new Promise((r) => setTimeout(r, 40));
        expect(editOf(c).querySelector('span.ci-emoji')).not.toBeNull();
        expect(editOf(c).querySelector('span.ci-emoji img')).toBeNull();
        window.dispatchEvent(new CustomEvent('tg-emoji-url', { detail: { docId: '9002', url: 'blob:prev2', kind: 'img' } }));
        refreshEmojiPreviews(editOf(c), { 'emojipack-9002': 'blob:prev2' });
        await new Promise((r) => setTimeout(r, 80));
        const img = editOf(c).querySelector('span.ci-emoji img[src="blob:prev2"]') as HTMLElement | null;
        expect(img).not.toBeNull();
        document.body.removeChild(c);
    });

    test('insert helpers work on detached root', () => {
        const root = document.createElement('div');
        insertInputText(root, 'ab');
        insertInputEmoji(root, '1', '❤', {});
        expect(serializeInput(root).entities).toEqual([{ offset: 2, length: 1, document_id: '1' }]);
    });
});
