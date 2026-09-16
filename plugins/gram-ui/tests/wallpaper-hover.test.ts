/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
}

describe('wallpaper hover sheen', () => {
    test('cells sweep a sheen overlay on hover and keyboard focus', () => {
        const css = builtCss();
        expect(css).toContain('.tgui-wall-cell::after');
        expect(css).toContain('.tgui-wall-cell:hover::after');
        expect(css).toContain('.tgui-wall-cell:focus-visible::after');
        expect(css).toContain('@keyframes tgui-wall-sheen');
    });

    test('sheen travels across the cell and fades at rest', () => {
        const css = builtCss();
        expect(css).toContain('translateX(-130%)');
        expect(css).toContain('translateX(130%)');
        expect(css).toContain('opacity: 0');
        expect(css).toContain('pointer-events: none');
    });

    test('sheen stays above artwork but never steals clicks', () => {
        const css = builtCss();
        const afterBlock = /\.tgui-wall-cell::after\s*\{[^}]*\}/.exec(css);
        expect(afterBlock).not.toBeNull();
        expect(afterBlock![0]).toContain('z-index: 2');
        expect(afterBlock![0]).toContain('position: absolute');
    });

    test('reduced motion disables the sheen', () => {
        const css = builtCss();
        const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.tgui-wall-cell::after\s*\{[^}]*display:\s*none/.exec(css);
        expect(reduced).not.toBeNull();
    });
});

describe('wallpaper gradient flow', () => {
    test('angle is registered animatable with a seamless loop', () => {
        const css = builtCss();
        expect(css).toContain('@property --wall-angle');
        expect(css).toContain('@keyframes tgui-wall-flow');
        expect(css).toContain('--wall-from, 135deg) + 360deg');
    });

    test('cells run the flow on hover and freeze without snapping', () => {
        const css = builtCss();
        const baseBlock = /\.tgui-wall-cell\s*\{[^}]*\}/.exec(css);
        expect(baseBlock).not.toBeNull();
        expect(baseBlock![0]).toContain('tgui-wall-flow');
        expect(baseBlock![0]).toContain('paused');
        const hoverBlock = /\.tgui-wall-cell:hover\s*\{[^}]*\}/.exec(css);
        expect(hoverBlock).not.toBeNull();
        expect(hoverBlock![0]).toContain('running');
    });

    test('preview background flows continuously', () => {
        const css = builtCss();
        const blocks = [...css.matchAll(/\.tgui-wall-preview-bg\s*\{[^}]*\}/g)].map((m) => m[0]);
        const bgBlock = blocks.find((b) => b.includes('position: absolute'));
        expect(bgBlock).toBeTruthy();
        expect(bgBlock!).toContain('tgui-wall-flow');
    });

    test('reduced motion disables the flow', () => {
        const css = builtCss();
        expect(css).toContain('.tgui-wall-preview-bg');
        const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.tgui-wall-preview-bg\s*\{[^}]*animation:\s*none/.exec(css);
        expect(reduced).not.toBeNull();
    });
});
