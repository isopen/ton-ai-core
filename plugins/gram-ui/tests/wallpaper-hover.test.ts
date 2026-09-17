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

    test('chat body flows like preview when background uses the angle', () => {
        const css = builtCss();
        const flowBlock = /\.tgui-chat-body_flow\s*\{[^}]*\}/.exec(css);
        expect(flowBlock).not.toBeNull();
        expect(flowBlock![0]).toContain('tgui-wall-flow');
        expect(flowBlock![0]).toContain('18s');
    });

    test('background flow ignores OS reduced motion, app toggle kills it', () => {
        const css = builtCss();
        expect(css).toContain('.tgui-wall-preview-bg');
        const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g)].map((m) => m[0]);
        expect(blocks.length).toBeGreaterThan(0);
        for (const b of blocks) {
            expect(b).not.toContain('.tgui-wall-preview-bg');
            expect(b).not.toContain('.tgui-wall-preview-pattern');
            expect(b).not.toContain('.tgui-chat-body_flow');
            expect(b).not.toContain('.tgui-chat-wallpattern');
        }
        expect(css).toContain('[data-animations="off"]');
        expect(css).toContain('animation: none !important');
    });

    test('gallery shows three cells per row', () => {
        const css = builtCss();
        const gridBlock = /\.tgui-wall-grid\s*\{[^}]*\}/.exec(css);
        expect(gridBlock).not.toBeNull();
        expect(gridBlock![0]).toContain('repeat(3, 1fr)');
        expect(gridBlock![0]).toContain('480px');
    });

    test('collapsible frame pads gallery content like menu items', () => {
        const css = builtCss();
        const blocks = [...css.matchAll(/\.tgui-menu-content\s*\{[^}]*\}/g)].map((m) => m[0]);
        expect(blocks.some((b) => b.includes('var(--spacing-lg)'))).toBe(true);
    });
});

describe('wallpaper preview card', () => {
    test('card is a top-level rule right after the reduced-motion block', () => {
        const css = builtCss();
        const anchor = '}\n\n.tgui-wall-preview-card {';
        expect(css).toContain(anchor);
        const cardBlock = /\.tgui-wall-preview-card\s*\{[^}]*\}/.exec(css.slice(css.indexOf(anchor)));
        expect(cardBlock).not.toBeNull();
        expect(cardBlock![0]).toContain('border-radius: 16px');
        expect(cardBlock![0]).toContain('overflow: hidden');
        expect(cardBlock![0]).toContain('480px');
        expect(cardBlock![0]).toContain('100dvh');
    });
