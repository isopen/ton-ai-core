import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { wallpaperIdentity, wallpaperPhotoDoc, isPatternWallpaper, wallpaperFlowValue, wallpaperFlowProps, wallpaperRender, wallpaperThumbType } from '../utils.js';
import { requestDocument, requestDocumentThumb } from './media-source.js';
import { Image } from '../primitives/image.js';
import { loadDefaultWallpaper, saveDefaultWallpaper } from './wallpaper-store.js';
import { WallpaperPreviewContent } from './wallpaper-preview.js';
import { MediaViewer } from './media-viewer.js';

const wallPickLog = getLogger('gram-ui:wallpaper');

const PRESS_DELAY = 450;
const PRESS_SLOP = 12;

function pickKey(w: any): string {
  return 'wallpaper-pick-' + String(w?.id ?? '') + '-' + String(w?.slug ?? '');
}

function WallpaperCell({ wallpaper, selected, url, onPick, onPreview }: { wallpaper: any; selected: boolean; url: string; onPick: () => void; onPreview: (angle: string) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const disarm = () => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressPos.current = null;
  };
  useEffect(() => disarm, []);
  const onArm = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e as PointerEvent).isPrimary === false) return;
    disarm();
    suppressClick.current = false;
    pressPos.current = { x: e.clientX || 0, y: e.clientY || 0 };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressPos.current = null;
      suppressClick.current = true;
      let seed = '';
      const held = ref.current;
      if (held) {
        const cur = getComputedStyle(held).getPropertyValue('--wall-angle').trim();
        if (/^-?[\d.]+deg$/.test(cur)) seed = cur;
      }
      wallPickLog.info('[wallpaper] preview hold id=' + String(wallpaper?.id ?? ''));
      onPreview(seed);
    }, PRESS_DELAY);
  };
  const onTrack = (e: PointerEvent) => {
    if (pressTimer.current == null || !pressPos.current) return;
    const dx = (e.clientX || 0) - pressPos.current.x;
    const dy = (e.clientY || 0) - pressPos.current.y;
    if (dx * dx + dy * dy > PRESS_SLOP * PRESS_SLOP) disarm();
  };
  const onRelease = () => disarm();
  const onPress = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onPick();
  };
  const onMenu = (e: MouseEvent) => {
    if (suppressClick.current) e.preventDefault();
  };
  const doc = wallpaperPhotoDoc(wallpaper);
  const key = pickKey(wallpaper);
  const thumbType = doc && !isPatternWallpaper(wallpaper) ? wallpaperThumbType(doc) : null;
  const urlRef = useRef(url);
  urlRef.current = url;
  useEffect(() => {
    if (!doc || urlRef.current) return;
    const request = () => {
      if (urlRef.current) return;
      if (thumbType) requestDocumentThumb(doc, key, thumbType, { tag: 'WallpaperGallery' });
      else requestDocument(doc, key, 1, { tag: 'WallpaperGallery' });
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      request();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          request();
          io.disconnect();
        }
      }
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, [doc, key, thumbType]);
  const flowValue = wallpaperFlowValue(wallpaper);
  const flowProps = wallpaperFlowProps(wallpaper);
  const pattern = isPatternWallpaper(wallpaper);
  const render = pattern ? wallpaperRender(wallpaper, url) : null;
  const spec = !pattern && url
    ? {
        id: key,
        medium: { url, width: 0, height: 0 },
        width: 0,
        height: 0,
      }
    : null;
  return (
    <button
      ref={ref}
      class={'tgui-wall-cell' + (selected ? ' is-selected' : '')}
      style={pattern ? render!.body : (flowValue ? `background:${flowValue};${flowProps}` : '')}
      onClick={onPress}
      onPointerDown={onArm}
      onPointerMove={onTrack}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={onMenu}
      aria-label="wallpaper"
    >
      {pattern
        ? (render!.showPattern ? <div class="tgui-wall-pattern" style={render!.pattern} /> : null)
        : (spec ? <Image image={spec} lazy={false} /> : null)}
    </button>
  );
}

export function WallpaperPicker({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const list = Array.isArray(state.accountWallpapers) ? state.accountWallpapers : null;
  const urls = (state.documentUrls || {}) as Record<string, string>;
  useEffect(() => {
    let cancelled = false;
    void loadDefaultWallpaper().then((w) => {
      if (!cancelled && w) dispatch({ type: 'SET_DEFAULT_WALLPAPER', wallpaper: w });
    });
    return () => { cancelled = true; };
  }, [dispatch]);
  const pick = (w: any | null) => {
    wallPickLog.info('[wallpaper] pick ' + (w ? String(w._) + ' id=' + String(w.id ?? '') : 'default'));
    void saveDefaultWallpaper(w);
    dispatch({ type: 'SET_DEFAULT_WALLPAPER', wallpaper: w });
  };
  const [preview, setPreview] = useState<{ w: any; angle: string } | null>(null);
  const closePreview = () => setPreview(null);
  const applyPreview = () => {
    if (!preview) return;
    pick(preview.w);
    setPreview(null);
  };
  const selectedIdentity = wallpaperIdentity(state.defaultWallpaper || null);
  return (
    <>
      <div class="tgui-settings-row">
        <span class="tgui-settings-label">{t(S.WALLPAPER_TITLE)}</span>
      </div>
      {list == null
        ? <div class="tgui-wall-hint">{t(S.WALLPAPER_LOADING)}</div>
        : (list.length === 0
          ? <div class="tgui-wall-hint">{t(S.WALLPAPER_EMPTY)}</div>
          : <div class="tgui-wall-grid">
            <button
              class={'tgui-wall-cell tgui-wall-default' + (state.defaultWallpaper ? '' : ' is-selected')}
              onClick={() => pick(null)}
              aria-label="default wallpaper"
            >
              <span>{t(S.WALLPAPER_DEFAULT)}</span>
            </button>
            {list.map((w) => (
              <WallpaperCell
                key={wallpaperIdentity(w)}
                wallpaper={w}
                selected={!!selectedIdentity && wallpaperIdentity(w) === selectedIdentity}
                url={urls[pickKey(w)] || ''}
                onPick={() => pick(w)}
                onPreview={(angle) => setPreview({ w, angle })}
              />
            ))}
          </div>)}
      {preview ? (
        <MediaViewer
          items={[{ kind: 'wallpaper', content: <WallpaperPreviewContent wallpaper={preview.w} angle={preview.angle} urls={urls} /> }]}
          index={0}
          documentUrls={urls}
          onClose={closePreview}
          actions={{ applyLabel: t(S.WALLPAPER_APPLY), closeLabel: t(S.WALLPAPER_PREVIEW_CLOSE), onApply: applyPreview }}
        />
      ) : null}
    </>
  );
}
