import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';
import { giftBackgroundColors, giftPatternColor } from './gift-shared.js';
import { GIFT_HALO_OFFSET_Y, giftMotifLayout, paintGiftMotif } from './gift-pattern-layout.js';

export type GiftBackdropVariant = 'card' | 'hero' | 'tile';

const LAYOUTS: Record<GiftBackdropVariant, { small: boolean; haloOffsetY: number }> = {
  card: { small: false, haloOffsetY: GIFT_HALO_OFFSET_Y.chat },
  hero: { small: false, haloOffsetY: GIFT_HALO_OFFSET_Y.default },
  tile: { small: true, haloOffsetY: GIFT_HALO_OFFSET_Y.grid },
};

export interface GiftBackdropProps {
  gift: any;

  motifImage?: CanvasImageSource | null;

  motifUrl?: string;

  variant?: GiftBackdropVariant;

  motifState?: string;

  data?: Record<string, string>;
  className?: string;
  style?: string;
  children?: any;
}

export function GiftBackdrop({ gift, motifImage, motifUrl, variant = 'hero', motifState, data, className, style, children }: GiftBackdropProps) {
  const { center, edge } = giftBackgroundColors(gift);
  const patternColor = giftPatternColor(gift);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { small, haloOffsetY } = LAYOUTS[variant];
  const layout = giftMotifLayout(small);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !motifImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.width = layout.width + 'px';
    canvas.style.height = layout.height + 'px';
    paintGiftMotif(motifImage, {
      ctx,
      width: layout.width,
      height: layout.height,
      positions: layout.positions,
      dpr,
      color: patternColor,
    });
  }, [motifImage, layout, patternColor]);

  const attrs: Record<string, string> = { ...(data || {}) };
  attrs['data-variant'] = variant;
  attrs['data-motif'] = motifState || (motifImage ? 'ready' : 'none');
  attrs['data-motif-count'] = String(layout.positions.length);
  attrs['data-motif-src'] = motifUrl || '';
  attrs['data-motif-canvas'] = layout.width + 'x' + layout.height;
  attrs['data-motif-has-thumb'] = attrs['data-motif-has-thumb'] || '';
  attrs['data-halo-offset-y'] = haloOffsetY + 'px';

  const vars = [
    edge ? `--gift-edge-color:${edge};` : '',
    center ? `--gift-center-color:${center};` : '',
    `--gift-halo-offset-y:${haloOffsetY}px;`,
  ].join('');

  return (
    <div
      class={'tgui-gift-backdrop' + (className ? ' ' + className : '')}
      style={vars + (style || '')}
      {...attrs}
    >
      <canvas
        ref={(el: any) => { canvasRef.current = el; }}
        class={'tgui-gift-backdrop__motif' + (small ? ' tgui-gift-backdrop__motif_small' : '')}
      />
      <div class={'tgui-gift-backdrop__halo' + (small ? ' tgui-gift-backdrop__halo_small' : '')} />
      {children}
    </div>
  );
}
