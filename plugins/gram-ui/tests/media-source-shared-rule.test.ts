/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { EmojiText } from '../dist/components/emoji-text.js';
import { TmdView } from '../dist/components/tmd-view.js';
import { RichMessageView } from '../dist/components/rich-message.js';
import { GLYPH_SOURCE, UNKNOWN_SOURCE, lookupDocumentSource, resolveEmojiSource, resolveKeyedSource, resolveStickerSource } from '../dist/components/emoji-source.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);
let blobSeq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:dot-' + (blobSeq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const TOWER = '\u{1F3C6}';
const MEDAL = '\u{1F947}';
const GIFT = '\u{1F49F}';
const POST = 'Победители\n1. ' + TOWER + ' НУТЕР МИЛЛИОНАС — Light Sword #124326\n2. ' + MEDAL + ' Schdrnk — Light Sword #39494\n' + GIFT + ' Победители выбраны по хешу блока TON';
const POST_EMOJI = 3;

async function mount(node: any): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => node;
  render(Probe, container);
  await wait();
  return container;
}

function dots(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll('.tgui-media-source-badge--dot')) as HTMLElement[];
}

describe('the indicator rule itself', () => {
  test('a glyph has no document, so the glyph is the source', () => {
    expect(resolveEmojiSource(undefined, undefined)).toBe(GLYPH_SOURCE);
    expect(resolveEmojiSource('', { 'emojipack-1': 'memory' })).toBe(GLYPH_SOURCE);
    expect(GLYPH_SOURCE).toBe('glyph');
  });

  test('a document reports whatever the download reported', () => {
    const sources = { 'emojipack-7': 'cdn-server', 'emoji-8': 'migrate-server', 9: 'persisted' };
    expect(resolveEmojiSource('7', sources)).toBe('cdn-server');
    expect(resolveEmojiSource(8, sources)).toBe('migrate-server');
    expect(resolveEmojiSource(9, sources)).toBe('persisted');
  });

  test('an unknown source reads as unknown, never as a guess and never as silence', () => {
    expect(resolveEmojiSource('7', {})).toBe(UNKNOWN_SOURCE);
    expect(resolveEmojiSource('7', undefined)).toBe(UNKNOWN_SOURCE);

    expect(lookupDocumentSource(undefined, { 'emojipack-7': 'memory' })).toBeUndefined();
    expect(lookupDocumentSource('7', {})).toBeUndefined();
  });

  test('stickers, gifs and gifts are documents keyed by their own prefix', () => {
    const sources = { 'sticker-3': 'memory', 'gif-4': 'home-server' };
    expect(resolveKeyedSource('sticker-3', sources)).toBe('memory');
    expect(resolveKeyedSource('gif-4', sources)).toBe('home-server');

    expect(resolveKeyedSource('sticker-9', sources)).toBe(UNKNOWN_SOURCE);
    expect(resolveKeyedSource('', sources)).toBe(UNKNOWN_SOURCE);
    expect(resolveStickerSource('sticker-9', sources)).toBe(UNKNOWN_SOURCE);
  });
});

describe('every chat surface marks the same emoji the same way', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', true));
  afterEach(() => { document.body.innerHTML = ''; });

  test('plain chat text', async () => {
    const root = await mount(h(EmojiText as any, { text: POST, documentUrls: {} }));
    expect(dots(root)).toHaveLength(POST_EMOJI);
    expect(dots(root).every((d) => d.className.includes('--glyph'))).toBe(true);
    expect(dots(root).every((d) => d.getAttribute('title') === 'text glyph')).toBe(true);
  });

  test('TMD post', async () => {
    const root = await mount(h(TmdView as any, { text: POST, documentUrls: {}, documentSources: {} }));
    expect(dots(root)).toHaveLength(POST_EMOJI);
    expect(dots(root).every((d) => d.className.includes('--glyph'))).toBe(true);
  });

  test('rich bot message', async () => {
    const richMessage = { blocks: [{ _: 'messageText', text: { _: 'textPlain', text: POST } }] };
    const root = await mount(h(RichMessageView as any, { richMessage, messageId: '77', documentUrls: {}, documentSources: {} }));
    expect(dots(root)).toHaveLength(POST_EMOJI);
    expect(dots(root).every((d) => d.className.includes('--glyph'))).toBe(true);
  });

  test('the glyph is still rendered, not swallowed by the indicator', async () => {
    const richMessage = { blocks: [{ _: 'messageText', text: { _: 'textPlain', text: POST } }] };
    const root = await mount(h(RichMessageView as any, { richMessage, messageId: '78', documentUrls: {}, documentSources: {} }));
    expect(root.querySelectorAll('.tgui-emoji-static')).toHaveLength(POST_EMOJI);
    expect(root.textContent).toContain(TOWER);
  });
});

describe('a post mixing custom emoji and plain glyphs marks both', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', true));
  afterEach(() => { document.body.innerHTML = ''; });

  const entities = [{ _: 'messageEntityCustomEmoji', offset: 1, length: 2, document_id: 42 }];
  const mixed = 'A' + MEDAL + 'B' + TOWER + 'C';

  test('TMD: the custom emoji gets its document source, the glyph gets glyph', async () => {
    const root = await mount(h(TmdView as any, {
      text: mixed,
      foreignEntities: entities,
      documentUrls: {},
      documentSources: { 'emojipack-42': 'cdn-server' },
    }));
    const painted = dots(root);
    expect(painted).toHaveLength(2);
    expect(painted.filter((d) => d.className.includes('--srv'))).toHaveLength(1);
    expect(painted.filter((d) => d.className.includes('--glyph'))).toHaveLength(1);
  });

  test('rich: same post, same two dots', async () => {
    const richMessage = {
      blocks: [{
        _: 'messageText',
        text: {
          _: 'textConcat',
          texts: [
            { _: 'textPlain', text: 'A' },
            { _: 'textCustomEmoji', document_id: 42, alt: MEDAL },
            { _: 'textPlain', text: 'B' + TOWER + 'C' },
          ],
        },
      }],
    };
    const root = await mount(h(RichMessageView as any, {
      richMessage,
      messageId: '79',
      documentUrls: {},
      documentSources: { 'emojipack-42': 'migrate-server' },
    }));
    const painted = dots(root);
    expect(painted).toHaveLength(2);
    expect(painted.filter((d) => d.className.includes('--srv'))).toHaveLength(1);
    expect(painted.filter((d) => d.className.includes('--glyph'))).toHaveLength(1);
  });

  test('an unreported document source paints a neutral dot, and the glyph keeps its own', async () => {
    const root = await mount(h(TmdView as any, {
      text: mixed,
      foreignEntities: entities,
      documentUrls: {},
      documentSources: {},
    }));
    const painted = dots(root);
    expect(painted).toHaveLength(2);
    expect(painted.filter((d) => d.className.includes('--db'))).toHaveLength(1);
    expect(painted.filter((d) => d.className.includes('--glyph'))).toHaveLength(1);
  });
});

describe('the picker follows the same rule', () => {
  const pickerSrc = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/components/emoji-picker.js'), 'utf8');

  test('emoji cells resolve their source through the shared rule', () => {
    expect(pickerSrc).toContain('resolveEmojiSource');
    expect(pickerSrc).toContain('resolveStickerSource');
    expect(pickerSrc).not.toMatch(/documentSources\[['\"]emojipack-/);
    expect(pickerSrc).not.toMatch(/documentSources\[['\"](sticker|gif|gift)-/);
  });
});
