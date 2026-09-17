/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { WallpaperGallery } from '../dist/components/wallpaper-picker.js';
import { SettingsView } from '../dist/components/settings-view.js';
import { defaultState } from '../dist/state.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const FILL = { _: 'wallPaperNoFile', id: '2', settings: { background_color: 0xFF112233 } };
const PATTERN = {
  _: 'wallPaper', id: '9', slug: 's9', pattern: true,
  document: { _: 'document', id: 'd9', thumbs: [{ _: 'photoSize', type: 'm' }] },
  settings: { background_color: 0xFF112233, intensity: 60 },
};
const PHOTO = {
  _: 'wallPaper', id: '7', slug: 's7',
  document: { _: 'document', id: 'd7', thumbs: [{ _: 'photoSize', type: 's' }, { _: 'photoSize', type: 'm' }] },
};

function mountPicker(state: any): { container: HTMLElement; actions: any[] } {
  const actions: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(WallpaperGallery as any, { state, dispatch: (a: any) => { actions.push(a); } });
  render(Probe, container);
  return { container, actions };
}

describe('wallpaper gallery in settings', () => {
  test('gallery renders without own frame', async () => {
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 60));
    expect(container.querySelector('.tgui-menu-list')).toBeNull();
    expect(container.querySelector('.tgui-wall-grid')).not.toBeNull();
    document.body.removeChild(container);
  });

  test('loading hint before server list arrives', async () => {
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: null });
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('.tgui-wall-grid')).toBeNull();
    expect(container.querySelector('.tgui-wall-hint')?.textContent).toBe('Loading wallpapers...');
    document.body.removeChild(container);
  });

  test('grid renders default plus server cells with gradients', async () => {
    const thumbs: any[] = [];
    const fulls: any[] = [];
    const onThumb = (e: Event) => { thumbs.push((e as CustomEvent).detail); };
    const onDl = (e: Event) => { fulls.push((e as CustomEvent).detail); };
    window.addEventListener('tg-download-document-thumb', onThumb);
    window.addEventListener('tg-download-document', onDl);
    try {
      const { container } = mountPicker({ ...defaultState(), accountWallpapers: [FILL, PATTERN, PHOTO], documentUrls: {} });
      await new Promise((r) => setTimeout(r, 60));
      const cells = container.querySelectorAll('.tgui-wall-cell');
      expect(cells.length).toBe(4);
      expect(container.querySelector('.tgui-wall-default.is-selected')).not.toBeNull();
      const html = container.innerHTML;
      expect(html.includes('#112233')).toBe(true);
      expect(thumbs.length).toBe(1);
      expect(String(thumbs[0].document.id)).toBe('d7');
      expect(thumbs[0].thumbType).toBe('m');
      expect(fulls.map((d) => String(d.document.id)).sort()).toEqual(['d9']);
      document.body.removeChild(container);
    } finally {
      window.removeEventListener('tg-download-document-thumb', onThumb);
      window.removeEventListener('tg-download-document', onDl);
    }
  });

  test('clicking a cell dispatches default wallpaper', async () => {
    const { container, actions } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 60));
    const cells = container.querySelectorAll('.tgui-wall-cell');
    expect(cells.length).toBe(2);
    (cells[1] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 30));
    const set = actions.find((a) => a.type === 'SET_DEFAULT_WALLPAPER');
    expect(set).toBeTruthy();
    expect(set.wallpaper).toBe(FILL);
    document.body.removeChild(container);
  });

  test('selected cell marked when default set', async () => {
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: [FILL, PATTERN], documentUrls: {}, defaultWallpaper: PATTERN });
    await new Promise((r) => setTimeout(r, 60));
    const selected = container.querySelectorAll('.tgui-wall-cell.is-selected');
    expect(selected.length).toBe(1);
    expect(container.querySelector('.tgui-wall-default.is-selected')).toBeNull();
    document.body.removeChild(container);
  });

  test('pattern cell composites tile exactly like preview and chat', async () => {
    const { container } = mountPicker({
      ...defaultState(),
      accountWallpapers: [PATTERN],
      documentUrls: { ['wallpaper-pick-9-s9']: 'blob:tile' },
    });
    await new Promise((r) => setTimeout(r, 60));
    const cell = container.querySelectorAll('.tgui-wall-cell')[1] as HTMLElement;
    const style = cell.getAttribute('style') || '';
    expect(style.includes('#112233')).toBe(true);
    expect(style.includes('blob:tile')).toBe(false);
    const tile = cell.querySelector('div.tgui-wall-pattern') as HTMLElement;
    expect(tile).not.toBeNull();
    expect(tile.getAttribute('style') || '').toContain('blob:tile');
    expect(cell.querySelector('div.TguiImage')).toBeNull();
    document.body.removeChild(container);
  });

  test('negative intensity pattern masks like preview', async () => {
    const dark = { ...PATTERN, settings: { background_color: 0xFF112233, intensity: -50 } };
    const { container } = mountPicker({
      ...defaultState(),
      accountWallpapers: [dark],
      documentUrls: { ['wallpaper-pick-9-s9']: 'blob:tile' },
    });
    await new Promise((r) => setTimeout(r, 60));
    const cell = container.querySelectorAll('.tgui-wall-cell')[1] as HTMLElement;
    expect(cell.getAttribute('style') || '').toContain('#0e1621');
    expect((cell.querySelector('div.tgui-wall-pattern') as HTMLElement).getAttribute('style') || '').toContain('mask-image');
    document.body.removeChild(container);
  });
});

describe('settings chat-settings navigation', () => {
  function mountSettings(state: any): { container: HTMLElement; actions: any[] } {
    const actions: any[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(SettingsView as any, { state, dispatch: (a: any) => { actions.push(a); } });
    render(Probe, container);
    return { container, actions };
  }

  test('menu lists Chat Settings, grid opens on click', async () => {
    const { container } = mountSettings({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await new Promise((r) => setTimeout(r, 30));
    const item = container.querySelector('.tgui-menu-item') as HTMLElement | null;
    expect(item).not.toBeNull();
    expect(item?.textContent).toBe('Chat Settings');
    expect(container.querySelector('.tgui-wall-grid')).toBeNull();
    item!.click();
    await new Promise((r) => setTimeout(r, 60));
    const headers = Array.from(container.querySelectorAll('.tgui-settings-section .tgui-menu-item')) as HTMLElement[];
    expect(headers.map((el) => el.textContent)).toEqual(['Chat background']);
    expect(headers[0].getAttribute('aria-expanded')).toBe('false');
    headers[0].click();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('.tgui-wall-grid')).not.toBeNull();
    expect(container.querySelector('.tgui-menu-back')).not.toBeNull();
    (container.querySelector('.tgui-menu-back') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('.tgui-wall-grid')).toBeNull();
    expect(container.querySelector('.tgui-menu-item')).not.toBeNull();
    document.body.removeChild(container);
  });
});
