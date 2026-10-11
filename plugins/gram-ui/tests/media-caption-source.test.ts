/**
 * @jest-environment jsdom
 */


import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'node:util';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { MediaCaption } from '../dist/components/media-caption.js';

(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(0), 0);
let blobSeq = 0;
(globalThis as any).URL.createObjectURL = () => 'blob:cap-' + (blobSeq++);
(globalThis as any).URL.revokeObjectURL = () => { };

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const GLYPH = '\u{1F3C6}';
const CUSTOM = '\u{1F947}';
const DOC = '4242';

async function mountCaption(props: Record<string, any>): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(MediaCaption as any, { timeStr: '17:50', out: false, status: 'sent', ...props });
  render(Probe, container);
  await wait();
  return container;
}

describe('captions follow the same indicator rule as message text', () => {
  beforeAll(() => setScope('gram-ui:media-source-badge', true));
  afterEach(() => {
    document.body.innerHTML = '';
    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [] } }));
  });

  test('a plain glyph in a caption is marked as a glyph', async () => {
    const root = await mountCaption({ text: GLYPH + ' A BIG Bonus Is Waiting for You!' });
    const dots = root.querySelectorAll('.tgui-media-source-badge--dot');
    expect(dots).toHaveLength(1);
    expect((dots[0] as HTMLElement).className).toContain('--glyph');
  });

  test('a custom emoji in a caption reports the source it was given', async () => {
    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries: [{ alt: CUSTOM, docId: DOC }] } }));
    const root = await mountCaption({
      text: CUSTOM + ' Claim your bonus now',
      documentUrls: { ['emojipack-' + DOC]: 'blob:cap-1' },
      documentSources: { ['emojipack-' + DOC]: 'cdn-server' },
    });
    const dots = root.querySelectorAll('.tgui-media-source-badge--dot');
    expect(dots).toHaveLength(1);
    expect((dots[0] as HTMLElement).className).toContain('--srv');
    expect((dots[0] as HTMLElement).getAttribute('title')).toBe('cdn-server');
  });

  test('a caption with no sources still marks its glyphs', async () => {
    const root = await mountCaption({ text: GLYPH + ' and ' + GLYPH });
    expect(root.querySelectorAll('.tgui-media-source-badge--glyph')).toHaveLength(2);
  });
});

describe('no text surface may silently drop the sources', () => {
  const built = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist', rel), 'utf8');

  function callSites(src: string, comp: string): string[] {
    const out: string[] = [];
    const needle = comp + ', {';
    let i = -1;
    while ((i = src.indexOf(needle, i + 1)) >= 0) {
      const end = src.indexOf(')', src.indexOf('documentSources', i) > 0 && src.indexOf('documentSources', i) < i + 400 ? src.indexOf('documentSources', i) + 14 : i);
      out.push(src.slice(i, (end > i && end < i + 600 ? end : i + 300) + 1));
    }
    return out;
  }

  test('every caption consumer forwards documentSources', () => {
    for (const file of ['components/chat-area.js', 'components/media-player.js', 'components/video-message.js', 'components/geo-bubble.js', 'components/media-collage.js']) {
      const sites = callSites(built(file), 'MediaCaption');
      expect(sites.length).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site).toContain('documentSources');
      }
    }
  });

  test('poll text forwards documentSources', () => {
    const sites = callSites(built('components/poll-bubble.js'), 'EmojiText');
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const site of sites) {
      expect(site).toContain('documentSources');
    }
  });

  test('input previews forward documentSources', () => {
    const src = built('components/send-input.js');
    expect(src).toMatch(/EmojiCanvas,[\s\S]{0,400}documentSources/);
  });
});
