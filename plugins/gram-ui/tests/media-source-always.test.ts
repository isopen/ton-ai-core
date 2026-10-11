/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { EmojiText, AnimatedEmoji } from '../dist/components/emoji-text.js';
import { EmojiCanvas } from '../dist/components/emoji-canvas.js';
import { Reactions } from '../dist/components/reactions.js';
import { UNKNOWN_SOURCE } from '../dist/components/emoji-source.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const GLYPH = '\u{1F3C6}';
const BUST = '\u{1F464}';

async function mount(node: any): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => node;
  render(Probe, container);
  await wait();
  return container;
}

const dots = (root: Element) => Array.from(root.querySelectorAll('.tgui-media-source-badge--dot')) as HTMLElement[];

describe('an emoji always paints an indicator', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', true));
  afterEach(() => { document.body.innerHTML = ''; });

  test('plain text glyphs are marked, whatever else is on screen', async () => {
    const root = await mount(h(EmojiText as any, { text: `${BUST} Смотрит на Twitch` }));
    const painted = dots(root);
    expect(painted).toHaveLength(1);
    expect(painted[0].className).toContain('--glyph');
  });

  test('a document with no reported origin is yellow, not invisible', async () => {
    const root = await mount(h(EmojiCanvas as any, {
      segments: [{ type: 'emoji', docId: '5150', value: BUST, custom: true }],
      documentUrls: { 'emojipack-5150': 'blob:a' },
      documentSources: {},
    }));
    const painted = dots(root);
    expect(painted).toHaveLength(1);
    expect(painted[0].className).toContain('--db');
    expect(painted[0].getAttribute('title')).toBe('unknown');
  });

  test('a document served by a DC is red', async () => {
    const root = await mount(h(EmojiCanvas as any, {
      segments: [{ type: 'emoji', docId: '5151', value: BUST, custom: true }],
      documentUrls: { 'emojipack-5151': 'blob:b' },
      documentSources: { 'emojipack-5151': 'migrate-server' },
    }));
    const painted = dots(root);
    expect(painted).toHaveLength(1);
    expect(painted[0].className).toContain('--srv');
    expect(painted[0].getAttribute('title')).toBe('migrate-server');
  });

  test('an emoji still waiting for its download is marked too', async () => {
    const root = await mount(h(AnimatedEmoji as any, { docId: undefined, url: '', alt: BUST, size: 19 }));
    const painted = dots(root);
    expect(painted).toHaveLength(1);
    expect(painted[0].className).toContain('--db');
  });

  test('a reaction chip is an emoji and gets the same treatment', async () => {
    const reactions = [{ emoji: BUST, count: 3, chosen: false }];
    const root = await mount(h(Reactions as any, {
      reactions,
      documentUrls: {},
      documentSources: {},
      onToggle: () => { },
    }));
    const chip = root.querySelector('.tgui-reaction__emoji') as HTMLElement;
    expect(chip).not.toBeNull();
    const painted = dots(chip);
    expect(painted).toHaveLength(1);

    expect(painted[0].className).toContain('--glyph');
  });
});

describe('the palette is red and yellow, with green as the one exception', () => {
  const css = () => fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  const hue = (sel: string) => (new RegExp('\\.' + sel + '\\s*\\{[^}]*--dot:\\s*([^;\\\\]+)').exec(css()) || [])[1];

  test('exactly three buckets are defined', () => {
    const defined = [...css().matchAll(/\.tgui-media-source-badge--([a-z]+)\s*\{[^}]*--dot:/g)].map((m) => m[1]);
    expect([...new Set(defined)].sort()).toEqual(['db', 'glyph', 'srv']);

    for (const gone of ['unknown', 'cdn', 'migrate', 'mem']) {
      expect(css()).not.toContain('.tgui-media-source-badge--' + gone);
    }
  });

  test('green is the one exception and holds exactly one category: a plain glyph', () => {
    expect(hue('tgui-media-source-badge--glyph')).toBe('#22c55e');
    expect(hue('tgui-media-source-badge--db')).toBe('#eab308');
    expect(hue('tgui-media-source-badge--srv')).toBe('#ef4444');
  });

  test('an unreported origin is yellow, never grey', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(EmojiCanvas as any, {
      segments: [{ type: 'emoji', docId: '616', value: BUST, custom: true }],
      documentUrls: { 'emojipack-616': 'blob:c' },
      documentSources: {},
    });
    render(Probe, container);
    return wait().then(() => {
      const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
      expect(dot.className).toContain('--db');
      expect(dot.getAttribute('title')).toBe('unknown');
      document.body.innerHTML = '';
    });
  });

  test('every DC is red, and the DC is still readable in the tooltip', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(EmojiCanvas as any, {
      segments: [{ type: 'emoji', docId: '617', value: BUST, custom: true }],
      documentUrls: { 'emojipack-617': 'blob:d' },
      documentSources: { 'emojipack-617': 'migrate-server' },
    });
    render(Probe, container);
    return wait().then(() => {
      const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
      expect(dot.className).toContain('--srv');
      expect(dot.getAttribute('title')).toBe('migrate-server');
      document.body.innerHTML = '';
    });
  });
});
