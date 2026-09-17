/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { WallpaperGallery } from '../dist/components/wallpaper-picker.js';
import { defaultState } from '../dist/state.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const FILL = { _: 'wallPaperNoFile', id: '2', settings: { background_color: 0xFF112233 } };

function mountPicker(state: any): { container: HTMLElement; actions: any[] } {
  const actions: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(WallpaperGallery as any, { state, dispatch: (a: any) => { actions.push(a); } });
  render(Probe, container);
  return { container, actions };
}

function pointerEvent(type: string, init: Record<string, any> = {}): Event {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(init)) {
    Object.defineProperty(e, k, { value: v, configurable: true });
  }
  return e;
}

function cellOf(container: HTMLElement): HTMLElement {
  const cells = container.querySelectorAll('.tgui-wall-cell');
  return cells[1] as HTMLElement;
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('wallpaper fullscreen preview on hold', () => {
  test('hold opens preview and swallows the release click', async () => {
    const { container, actions } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    const cell = cellOf(container);
    cell.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerType: 'mouse', button: 0 }));
    await settle(550);
    const preview = container.querySelector('.MediaViewer');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('role')).toBe('dialog');
    expect(preview?.textContent).toContain('Apply');
    expect(preview?.querySelectorAll('.tgui-wall-preview-chat .MessageBubble').length).toBe(4);
    expect(preview?.querySelector('.MediaViewer__backdrop')).not.toBeNull();
    cell.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    cell.click();
    await settle();
    expect(actions.find((a) => a.type === 'SET_DEFAULT_WALLPAPER')).toBeUndefined();
    expect(container.querySelector('.MediaViewer')).not.toBeNull();
    document.body.removeChild(container);
  });

  test('first click after preview close applies at once', async () => {
    const { container, actions } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    const cell = cellOf(container);
    cell.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    await settle(550);
    expect(container.querySelector('.MediaViewer')).not.toBeNull();
    const firstClose = Array.from(container.querySelectorAll('.tgui-wall-preview-bar button')).find((b) => b.textContent === 'Close preview') as HTMLElement;
    expect(firstClose).toBeTruthy();
    firstClose.click();
    await settle();
    expect(container.querySelector('.MediaViewer')).toBeNull();
    cell.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    cell.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    cell.click();
    await settle();
    const set = actions.find((a) => a.type === 'SET_DEFAULT_WALLPAPER');
    expect(set).toBeTruthy();
    expect(set.wallpaper).toBe(FILL);
    document.body.removeChild(container);
  });

  test('preview inherits the frozen cell angle', async () => {    const grad = { _: 'wallPaperNoFile', id: '3', settings: { background_color: 0xFF112233, second_background_color: 0xFF445566 } };
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: [grad], documentUrls: {} });
    await settle();
    cellOf(container).dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    await settle(550);
    const bg = container.querySelector('.tgui-wall-preview-bg') as HTMLElement;
    expect(bg).not.toBeNull();
    expect(bg.parentElement?.classList.contains('tgui-wall-preview-card')).toBe(true);
    expect(bg.getAttribute('style') || '').toContain('--wall-from:');
    expect(bg.parentElement?.classList.contains('tgui-wall-preview-card')).toBe(true);
    const bar = container.querySelector('.tgui-wall-preview-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.parentElement?.classList.contains('tgui-wall-preview-card')).toBe(true);
    document.body.removeChild(container);
  });

  test('short press applies without preview', async () => {
    const { container, actions } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    const cell = cellOf(container);
    cell.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerType: 'touch' }));
    await settle(100);
    cell.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    cell.click();
    await settle();
    expect(container.querySelector('.MediaViewer')).toBeNull();
    const set = actions.find((a) => a.type === 'SET_DEFAULT_WALLPAPER');
    expect(set).toBeTruthy();
    expect(set.wallpaper).toBe(FILL);
    document.body.removeChild(container);
  });

  test('drag beyond slop cancels preview', async () => {
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    const cell = cellOf(container);
    cell.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerType: 'touch' }));
    cell.dispatchEvent(pointerEvent('pointermove', { clientX: 60, clientY: 0 }));
    await settle(550);
    expect(container.querySelector('.MediaViewer')).toBeNull();
    document.body.removeChild(container);
  });

  test('apply in preview sets wallpaper and closes', async () => {
    const { container, actions } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    cellOf(container).dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    await settle(550);
    const preview = container.querySelector('.MediaViewer') as HTMLElement;
    expect(preview).not.toBeNull();
    const apply = Array.from(preview.querySelectorAll('button')).find((b) => b.textContent === 'Apply') as HTMLElement;
    expect(apply).toBeTruthy();
    apply.click();
    await settle();
    const set = actions.find((a) => a.type === 'SET_DEFAULT_WALLPAPER');
    expect(set).toBeTruthy();
    expect(set.wallpaper).toBe(FILL);
    expect(container.querySelector('.MediaViewer')).toBeNull();
    document.body.removeChild(container);
  });

  test('close button and Escape dismiss preview', async () => {
    const { container } = mountPicker({ ...defaultState(), accountWallpapers: [FILL], documentUrls: {} });
    await settle();
    const open = async () => {
      cellOf(container).dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
      await settle(550);
      expect(container.querySelector('.MediaViewer')).not.toBeNull();
    };
    await open();
    const closeBtn = Array.from(container.querySelectorAll('.tgui-wall-preview-bar button')).find((b) => b.textContent === 'Close preview') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    await settle();
    expect(container.querySelector('.MediaViewer')).toBeNull();
    await open();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(container.querySelector('.MediaViewer')).toBeNull();
    document.body.removeChild(container);
  });

  test('preview paints gallery image at once and upgrades to full', async () => {
    const photo = {
      _: 'wallPaper', id: '7', slug: 's7',
      document: { _: 'document', id: 'd7', mime_type: 'image/jpeg' },
    };
    const openWith = async (urls: Record<string, string>) => {
      const { container } = mountPicker({ ...defaultState(), accountWallpapers: [photo], documentUrls: urls });
      await settle();
      cellOf(container).dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
      await settle(550);
      const bg = container.querySelector('.tgui-wall-preview-bg') as HTMLElement;
      expect(bg).not.toBeNull();
      const style = bg.getAttribute('style') || '';
      document.body.removeChild(container);
      return style;
    };
    const thumbStyle = await openWith({ ['wallpaper-pick-7-s7']: 'blob:thumb' });
    expect(thumbStyle).toContain('blob:thumb');
    const fullStyle = await openWith({ ['wallpaper-pick-7-s7']: 'blob:thumb', ['wallpaper-preview-7-s7']: 'blob:full' });
    expect(fullStyle).toContain('blob:full');
    expect(fullStyle).not.toContain('blob:thumb');
  });
});
