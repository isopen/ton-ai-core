/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
}

describe('button emoji follow button text color', () => {
    test('control buttons flatten emoji to text contrast', () => {
        const css = builtCss();
        expect(css).toContain('.MessageBubble__kb-btn .TgsPlayer');
        expect(css).toContain('.rich-btn .TgsPlayer');
        expect(css).toContain('.MessageBubble__kb-btn.is-primary .TgsPlayer');
        expect(css).toContain('.rich-btn.is-primary .TgsPlayer');
    });

    test('quotes keep bot colors, never flattened', () => {
        const css = builtCss();
        const quoteBlackout = /\.rich-quote[^{]*\{[^}]*brightness\(0\)/;
        expect(quoteBlackout.test(css)).toBe(false);
    });

    test('emoji keeps inline layout inside buttons and quotes', () => {
        const css = builtCss();
        expect(css).toContain('.rich-btn .TgsPlayer');
        expect(css).toContain('.rich-quote .tgui-emoji-inline');
    });
});
