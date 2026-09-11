/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { TmdView } from '../dist/components/tmd-view.js';

function mount(props: Record<string, any>): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => ({ type: TmdView as any, props, children: [], key: null });
    render(Comp, container);
    return container;
}

describe('TmdView quote collapse toggle', () => {
    test('long legacy quote collapses and expands on quote click, no button', async () => {
        const quote = 'word '.repeat(80);
        const text = 'intro\n' + quote;
        const c = mount({
            text,
            foreignEntities: [{ _: 'messageEntityBlockquote', offset: 6, length: quote.length }],
        });
        await new Promise((r) => setTimeout(r, 100));
        const quoteEl = c.querySelector('blockquote.md-quote') as HTMLElement;
        expect(quoteEl).toBeTruthy();
        expect(quoteEl.classList.contains('md-quote_collapsed')).toBe(true);
        expect(c.querySelector('button')).toBeNull();
        quoteEl.click();
        await new Promise((r) => setTimeout(r, 50));
        expect(quoteEl.classList.contains('md-quote_collapsed')).toBe(false);
        quoteEl.click();
        await new Promise((r) => setTimeout(r, 50));
        expect(quoteEl.classList.contains('md-quote_collapsed')).toBe(true);
    });

    test('short quote has no toggle', async () => {
        const c = mount({
            text: 'say hi',
            foreignEntities: [{ _: 'messageEntityBlockquote', offset: 4, length: 2 }],
        });
        await new Promise((r) => setTimeout(r, 100));
        expect(c.querySelector('blockquote.md-quote')).toBeTruthy();
        expect(c.querySelector('blockquote.md-quote_collapsible')).toBeNull();
    });

    test('link click inside collapsible quote does not toggle', async () => {
        const body = '[link](https://example.org) ' + 'word '.repeat(80);
        const c = mount({
            text: 'intro\n\n' + body,
            foreignEntities: [{ _: 'messageEntityBlockquote', offset: 7, length: body.length }],
        });
        await new Promise((r) => setTimeout(r, 100));
        const quoteEl = c.querySelector('blockquote.md-quote_collapsible') as HTMLElement;
        expect(quoteEl).toBeTruthy();
        const link = quoteEl.querySelector('a.md-link') as HTMLElement;
        if (link) {
            link.click();
            await new Promise((r) => setTimeout(r, 50));
            expect(quoteEl.classList.contains('md-quote_collapsed')).toBe(true);
        }
    });
});
