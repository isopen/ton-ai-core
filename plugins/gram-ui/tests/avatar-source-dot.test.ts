/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { Avatar } from '../dist/primitives/avatar.js';
import { StaticEmojiText } from '../dist/components/emoji-canvas.js';

const css = fs.readFileSync(path.join(__dirname, '..', 'dist', 'styles.css'), 'utf8');

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function injectCss(): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function cssBlock(selector: string): string {
  const re = new RegExp('(^|[},])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(css);
  if (!m) throw new Error('no CSS rule for ' + selector);
  return m[2];
}

function renderInto(node: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Host: any = () => node;
  render(Host, container);
  return container;
}

describe('avatar source dot', () => {
  beforeAll(() => {
    setScope('gram-ui:media-source-badge', true);
    injectCss();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test.each([
    ['memory', 'tgui-media-source-badge--db'],
    ['persisted', 'tgui-media-source-badge--db'],
    ['home-server', 'tgui-media-source-badge--srv'],
    ['cdn-server', 'tgui-media-source-badge--srv'],
    ['migrate-server', 'tgui-media-source-badge--srv'],
  ])('%s paints %s outside the clipped media box', (source, mod) => {
    const container = renderInto(h(Avatar as any, { url: 'blob:av', initial: 'AB', color: '#1a4d8c', size: 'medium', source }));

    const avatar = container.querySelector('.Avatar') as HTMLElement;
    expect(avatar).not.toBeNull();

    expect(getComputedStyle(avatar).overflow).toBe('visible');

    const clip = avatar.querySelector('.Avatar__clip') as HTMLElement;
    expect(clip).not.toBeNull();
    expect(getComputedStyle(clip).overflow).toBe('hidden');

    const dot = avatar.querySelector('.' + mod) as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--dot');

    expect(dot.parentElement).toBe(avatar);
    expect(clip.contains(dot)).toBe(false);
  });

  test('an avatar with a picture but no reported source paints a neutral dot', () => {
    const container = renderInto(h(Avatar as any, { url: 'blob:av', initial: 'AB', color: '#1a4d8c', size: 'small' }));
    const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--db');
  });

  test('initials-only avatar has nothing to describe and paints no dot', () => {
    const container = renderInto(h(Avatar as any, { initial: 'AB', color: '#1a4d8c', size: 'small' }));
    const avatar = container.querySelector('.Avatar') as HTMLElement;
    expect(avatar.querySelector('.tgui-media-source-badge--dot')).toBeNull();
    expect(getComputedStyle(avatar).overflow).toBe('visible');
    expect(getComputedStyle(avatar.querySelector('.Avatar__clip') as HTMLElement).overflow).toBe('hidden');
  });

  test('no rule anywhere re-clips .Avatar', () => {
    const blocks = [...css.matchAll(/(^|[},])\s*([^{}]+?)\s*\{([^{}]*)\}/gm)]
      .map((m) => ({ sel: m[2].trim(), body: m[3] }))
      .filter((r) => r.sel.split(',').some((s) => s.trim().endsWith('.Avatar')))
      .filter((r) => /(^|[\s;])overflow(-[xy])?\s*:\s*(hidden|clip|auto|scroll)/.test(r.body));
    expect(blocks).toEqual([]);
  });
});

describe('text glyph dot', () => {
  beforeAll(() => {
    setScope('gram-ui:media-source-badge', true);
    injectCss();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a plain text emoji gets a filled green dot, not a hollow ring', () => {
    const block = cssBlock('.tgui-media-source-badge--glyph');
    expect(block).toContain('--dot: #22c55e');

    expect(block).not.toMatch(/background\s*:/);
    expect(block).not.toMatch(/border\s*:/);
  });

  test('the glyph dot renders on the glyph box and is filled by the shared dot paint', () => {
    const container = renderInto(h(StaticEmojiText as any, { value: '\u{1F600}', size: 19 }));
    const dot = container.querySelector('.tgui-media-source-badge--glyph') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('tgui-media-source-badge--dot');
    expect(dot.getAttribute('title')).toBe('text glyph');
    expect(getComputedStyle(dot).background).toContain('var(--dot)');
    expect(getComputedStyle(dot).getPropertyValue('--dot')).toBe('#22c55e');

    expect(getComputedStyle(dot).width).toBe('10px');
  });
});
