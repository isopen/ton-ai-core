import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect } from '@ton-ai/atom/hooks';
import { t, S } from '@ton-ai/gram-lang';
import { wallpaperRender, wallpaperPhotoDoc } from '../utils.js';
import { requestDocument } from './media-source.js';
import { MessageBubble } from './message-bubble.js';

export function previewUrlKey(w: any): string {
  return 'wallpaper-preview-' + String(w?.id ?? '') + '-' + String(w?.slug ?? '');
}

export function WallpaperPreviewContent({ wallpaper, angle, urls }: {
  wallpaper: any;
  angle: string;
  urls: Record<string, string>;
}) {
  const doc = wallpaperPhotoDoc(wallpaper);
  const key = previewUrlKey(wallpaper);
  const fullUrl = urls[key] || '';
  useEffect(() => {
    if (!doc || (urls[key] || '')) return;
    requestDocument(doc, key, 1, { tag: 'WallpaperPreview' });
  }, [doc, key]);
  const render = wallpaperRender(wallpaper, fullUrl, angle);
  return (
    <>
      <div class="tgui-wall-preview-bg" style={render.body} />
      {render.showPattern ? <div class="tgui-wall-preview-pattern" style={render.pattern} /> : null}
      <div class="tgui-wall-preview-chat">
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_IN)} time="" out={false} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_OUT)} time="" out={true} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_IN2)} time="" out={false} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_OUT2)} time="" out={true} status="read" />
      </div>
    </>
  );
}
