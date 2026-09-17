/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { render } from '@ton-ai/atom';
import { WallpaperGallery } from '../dist/components/wallpaper-picker.js';
import { ChatArea } from '../dist/components/chat-area.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const PHOTO = {
  _: 'wallPaper', id: '9', slug: 's9',
  document: { _: 'document', id: 'd9', mime_type: 'image/jpeg' },
  settings: { background_color: 0xff112233 },
};

function pickerState(urls: Record<string, string>, def: any): any {
  return {
    accountWallpapers: [PHOTO],
    documentUrls: urls,
    defaultWallpaper: def,
    syncWallpaper: false,
    loadingMessages: false,
  };
}

describe('photo wallpaper apply', () => {
  test('click on photo cell dispatches SET_DEFAULT_WALLPAPER', async () => {
    const seen: any[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(WallpaperGallery as any, { state: pickerState({ 'wallpaper-pick-9-s9': 'blob:thumb' }, null), dispatch: (a: any) => { seen.push(a); } });
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 50));
    const cell = container.querySelector('button.tgui-wall-cell:not(.tgui-wall-default)') as HTMLElement;
    assert.ok(cell, 'photo cell rendered');
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    const pick = seen.find((a) => a.type === 'SET_DEFAULT_WALLPAPER');
    assert.ok(pick, 'pick dispatched, seen=' + JSON.stringify(seen.map((a) => a.type)));
    assert.equal(pick.wallpaper, PHOTO);
    document.body.removeChild(container);
  });

  test('chat renders photo wall once its url arrives', async () => {
    const peer = { type: 'user', id: 1 };
    const state = {
      selectedPeer: peer,
      activeSkill: null,
      messages: [],
      dialogs: [{ peer }],
      documentUrls: { 'wallpaper-default': 'blob:full' },
      peerWallpapers: {},
      defaultWallpaper: PHOTO,
      loadingMessages: false,
    };
    const container = document.createElement('div');
    container.setAttribute('style', 'display:flex;flex-direction:column;height:600px');
    document.body.appendChild(container);
    const Comp: any = () => h(ChatArea as any, { state, dispatch: () => {}, skills: [] });
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 50));
    const body = container.querySelector('.tgui-chat-body') as HTMLElement;
    assert.ok(body, 'chat body rendered');
    assert.ok((body.getAttribute('style') || '').includes('blob:full'), 'photo url in body style: ' + body.getAttribute('style'));
    assert.equal(body.classList.contains('tgui-chat-body_flow'), false);
    document.body.removeChild(container);
  });
});
