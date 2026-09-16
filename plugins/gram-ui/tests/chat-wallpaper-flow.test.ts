/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { ChatArea } from '../dist/components/chat-area.js';
import * as fs from 'fs';
import * as path from 'path';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const FILL = { _: 'wallPaperNoFile', id: '2', settings: { background_color: 0xff112233, second_background_color: 0xff445566 } };
const PHOTO = { _: 'wallPaper', id: '7', slug: 's7', document: { _: 'document', id: 'd7', mime_type: 'image/jpeg' } };
const MASKED = { _: 'wallPaper', id: '9', slug: 's9', pattern: true, document: { _: 'document', id: 'd9', mime_type: 'image/png' }, settings: { background_color: 0xff112233, second_background_color: 0xff445566, intensity: -50 } };

function mount(wallpaper: any, urls: Record<string, string>): HTMLElement {
  const peer = { type: 'user', id: 1 };
  const state = {
    selectedPeer: peer,
    activeSkill: null,
    messages: [],
    dialogs: [{ peer }],
    documentUrls: urls,
    peerWallpapers: {},
    defaultWallpaper: wallpaper,
    loadingMessages: false,
  };
  const container = document.createElement('div');
  container.setAttribute('style', 'display:flex;flex-direction:column;height:600px');
  document.body.appendChild(container);
  const Comp: any = () => h(ChatArea as any, { state, dispatch: () => {}, skills: [] });
  render(Comp, container);
  return container;
}

describe('chat body gradient flow matches preview', () => {
  test('gradient fill enables the flow class', async () => {
    const c = mount(FILL, {});
    await new Promise((r) => setTimeout(r, 50));
    const body = c.querySelector('.tgui-chat-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.classList.contains('tgui-chat-body_flow')).toBe(true);
    expect(body.getAttribute('style') || '').toContain('var(--wall-angle');
    document.body.removeChild(c);
  });

  test('photo wall without url has neither flow class nor gradient', async () => {
    const c = mount(PHOTO, {});
    await new Promise((r) => setTimeout(r, 50));
    const body = c.querySelector('.tgui-chat-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.classList.contains('tgui-chat-body_flow')).toBe(false);
    document.body.removeChild(c);
  });

  test('masked pattern enables flow class and animated tile', async () => {
    const c = mount(MASKED, { 'wallpaper-default': 'blob:tile' });
    await new Promise((r) => setTimeout(r, 50));
    const body = c.querySelector('.tgui-chat-body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.classList.contains('tgui-chat-body_flow')).toBe(true);
    const tile = c.querySelector('.tgui-chat-wallpattern') as HTMLElement;
    expect(tile).not.toBeNull();
    expect(tile.getAttribute('style') || '').toContain('var(--wall-angle');
    expect(tile.getAttribute('style') || '').toContain('mask-image');
    document.body.removeChild(c);
  });
});

describe('chat and preview pattern tiles flow in sync', () => {
  test('both tiles run the same 18s loop', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
    const chatBlocks = [...css.matchAll(/\.tgui-chat-wallpattern\s*\{[^}]*\}/g)].map((m) => m[0]);
    const chatTile = chatBlocks.find((b) => b.includes('position: absolute'));
    expect(chatTile).toBeTruthy();
    expect(chatTile!).toContain('tgui-wall-flow');
    expect(chatTile!).toContain('18s');
    const previewBlocks = [...css.matchAll(/\.tgui-wall-preview-pattern\s*\{[^}]*\}/g)].map((m) => m[0]);
    const previewTile = previewBlocks.find((b) => b.includes('position: absolute'));
    expect(previewTile).toBeTruthy();
    expect(previewTile!).toContain('tgui-wall-flow');
    expect(previewTile!).toContain('18s');
  });

  test('tiles ignore OS reduced motion, app toggle kills them', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
    const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g)].map((m) => m[0]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b).not.toContain('.tgui-chat-wallpattern');
      expect(b).not.toContain('.tgui-wall-preview-pattern');
    }
    expect(css).toContain('[data-animations="off"]');
    expect(css).toContain('animation: none !important');
  });
});
