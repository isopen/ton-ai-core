/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { EmojiCanvas } from '../dist/components/emoji-canvas.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const css = () => fs
  .readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8')

  .replace(/\/\*[\s\S]*?\*\//g, '');
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function blocks(selector: string): string[] {
  const re = /(^|[},])\s*([^{}]+?)\s*\{([^{}]*)\}/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css()))) {
    const sels = m[2]!.split(',').map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[3]!);
  }
  return out;
}

function declares(selector: string, property: string): string {
  const hits = blocks(selector).filter((b) => new RegExp('(^|[;\\s])' + property + '\\s*:').test(b));
  return hits.length === 1 ? hits[0] : hits.join(' | ');
}

describe('the indicator is never clipped by the thing it annotates', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', true));
  afterEach(() => { document.body.innerHTML = ''; });

  test('the emoji slot does not clip, and the media box does', () => {
    expect(declares('.tgui-emoji-slot', 'overflow')).toMatch(/overflow:\s*visible/);
    const media = declares('.tgui-emoji-slot-media', 'overflow');
    expect(media).toMatch(/overflow:\s*hidden/);
    expect(blocks('.tgui-emoji-slot-media').join('')).toMatch(/inset:\s*0/);
  });

  test('the picker cell does not clip, and its media box does', () => {
    expect(declares('.tgui-emoji-cell', 'overflow')).toMatch(/overflow:\s*visible/);
    expect(declares('.tgui-emoji-cell-media', 'overflow')).toMatch(/overflow:\s*hidden/);
  });

  test('the slot carries no inline overflow that would slice the dot', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/components/emoji-canvas.js'), 'utf8');
    const style = /const slotStyle = `([^`]*)`/.exec(src);
    expect(style).not.toBeNull();
    expect(style![1]).not.toContain('overflow');
    expect(style![1]).toContain('position:relative');
  });

  test('the dot is a sibling of the clipped media, not a child of it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(EmojiCanvas as any, {
      segments: [{ type: 'emoji', docId: '900', value: '\u{1F464}', custom: true }],
      documentUrls: { 'emojipack-900': 'blob:x' },
      documentSources: { 'emojipack-900': 'memory' },
    });
    render(Probe, container);
    await wait();

    const slot = container.querySelector('.tgui-emoji-slot') as HTMLElement;
    expect(slot).not.toBeNull();
    const media = slot.querySelector('.tgui-emoji-slot-media') as HTMLElement;
    expect(media).not.toBeNull();
    const dot = slot.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
    expect(dot).not.toBeNull();

    expect(dot.parentElement).toBe(slot);
    expect(media.contains(dot)).toBe(false);
    expect(slot.style.overflow).not.toBe('hidden');
  });
});
