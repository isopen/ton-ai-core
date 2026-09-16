import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect } from '@ton-ai/atom/hooks';
import { t, S } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { wallpaperRender, wallpaperPhotoDoc } from '../utils.js';
import { requestDocument } from './media-source.js';
import { MessageBubble } from './message-bubble.js';
import { Button } from '../primitives/button.js';

const wallPrevLog = getLogger('gram-ui:wallpaper');

export function previewUrlKey(w: any): string {
  return 'wallpaper-preview-' + String(w?.id ?? '') + '-' + String(w?.slug ?? '');
}

export function WallpaperPreviewContent({ wallpaper, angle, urls, fallbackUrl, onClose, onApply }: {
  wallpaper: any;
  angle: string;
  urls: Record<string, string>;
  fallbackUrl: string;
  onClose: () => void;
  onApply: () => void;
}) {
  const doc = wallpaperPhotoDoc(wallpaper);
  const key = previewUrlKey(wallpaper);
  const fullUrl = urls[key] || '';
  const displayUrl = fullUrl || fallbackUrl;
  useEffect(() => {
    if (!doc) return;
    if (urls[key] || '') return;
    wallPrevLog.info('[wallpaper] preview request id=' + String(doc?.id ?? '') + ' key=' + key);
    requestDocument(doc, key, 1, { tag: 'WallpaperPreview' });
  }, [doc, key]);
  useEffect(() => {
    if (fullUrl) wallPrevLog.info('[wallpaper] preview full arrived key=' + key);
  }, [fullUrl, key]);
  const render = wallpaperRender(wallpaper, displayUrl, angle);
  return (
    <div class="tgui-wall-preview-card">
      <div class="tgui-wall-preview-bg" style={render.body} />
      {render.showPattern ? <div class="tgui-wall-preview-pattern" style={render.pattern} /> : null}
      <div class="tgui-wall-preview-chat">
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_IN)} time="" out={false} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_OUT)} time="" out={true} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_IN2)} time="" out={false} status="read" />
        <MessageBubble text={t(S.WALLPAPER_SAMPLE_OUT2)} time="" out={true} status="read" />
      </div>
      <div class="tgui-wall-preview-bar">
        <Button variant="ghost" onClick={onClose}>{t(S.WALLPAPER_PREVIEW_CLOSE)}</Button>
        <Button variant="primary" onClick={onApply}>{t(S.WALLPAPER_APPLY)}</Button>
      </div>
    </div>
  );
}
