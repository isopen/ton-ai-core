/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { TmdView } from '../dist/components/tmd-view.js';

const DIFF = [
    '- replyMarkup,',
    '- richMessage,',
    '+ replyMarkup,',
    '+ richDocumentUrls,',
].join('\n');

function mount(over: Record<string, unknown> = {}): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
        () => TmdView({
            text: DIFF,
            documentUrls: {},
            ...over,
        } as any) as any,
        container,
    );
    return container;
}

describe('a diff keeps its Telegram code entity', () => {
    test('server-sent pre entity renders code, not a bullet list', () => {
        const root = mount({
            foreignEntities: [{ _: 'messageEntityPre', offset: 0, length: DIFF.length }],
        });
        expect(root.querySelectorAll('ul.md-list-bullet')).toHaveLength(0);
        expect(root.querySelector('pre.md-pre')).not.toBeNull();
        expect(root.textContent).toContain('replyMarkup,');
    });

    test('code entity mid-message is respected too', () => {
        const text = 'Result:\n' + DIFF;
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(
            () => TmdView({
                text,
                documentUrls: {},
                foreignEntities: [{ _: 'messageEntityPre', offset: 'Result:\n'.length, length: DIFF.length }],
            } as any) as any,
            container,
        );
        expect(container.querySelectorAll('ul.md-list-bullet')).toHaveLength(0);
        expect(container.querySelector('pre.md-pre')).not.toBeNull();
    });

    test('messageEntityCode also wins over the gate', () => {
        const root = mount({
            foreignEntities: [{ _: 'messageEntityCode', offset: 0, length: DIFF.length }],
        });
        expect(root.querySelectorAll('ul.md-list-bullet')).toHaveLength(0);
    });

    test('a genuine markdown list still renders as a list', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(
            () => TmdView({
                text: '- first item\n- second item',
                documentUrls: {},
            } as any) as any,
            container,
        );
        expect(container.querySelectorAll('ul.md-list-bullet').length).toBeGreaterThan(0);
    });

    test('a real fenced code block still renders as code', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(
            () => TmdView({
                text: '```tsx\nconst a = 1;\n```',
                documentUrls: {},
            } as any) as any,
            container,
        );
        expect(container.querySelector('pre.md-pre')).not.toBeNull();
    });
});
