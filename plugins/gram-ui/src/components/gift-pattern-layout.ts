export const GIFT_MOTIF_ALPHA = { min: 0.1, mid: 0.2, max: 0.3 } as const;

export const GIFT_MOTIF_CANVAS = { width: 266, height: 184 } as const;

export const GIFT_MOTIF_CANVAS_SMALL = { width: 120, height: 120 } as const;

export const GIFT_HALO_OFFSET_Y = {
  default: -100,
  chat: -150,
  offer: -75,
  grid: -50,
} as const;

export const GIFT_MOTIF_POSITIONS: [number, number, number, number][] = [
  [55, 47, 18, GIFT_MOTIF_ALPHA.max],
  [23, 26, 18, GIFT_MOTIF_ALPHA.mid],
  [0, 64, 18, GIFT_MOTIF_ALPHA.mid],
  [0, 165, 18, GIFT_MOTIF_ALPHA.min],
  [17, 125, 18, GIFT_MOTIF_ALPHA.mid],
  [58, 141, 22, GIFT_MOTIF_ALPHA.max],
  [81, 13, 24, GIFT_MOTIF_ALPHA.max],
  [38, 82, 26, GIFT_MOTIF_ALPHA.max],
  [187, 46, 18, GIFT_MOTIF_ALPHA.max],
  [219, 26, 18, GIFT_MOTIF_ALPHA.mid],
  [119, 5, 18, GIFT_MOTIF_ALPHA.max],
  [242, 64, 18, GIFT_MOTIF_ALPHA.mid],
  [245, 165, 18, GIFT_MOTIF_ALPHA.min],
  [225, 125, 18, GIFT_MOTIF_ALPHA.mid],
  [118, 151, 22, GIFT_MOTIF_ALPHA.max],
  [180, 141, 22, GIFT_MOTIF_ALPHA.max],
  [155, 13, 24, GIFT_MOTIF_ALPHA.max],
  [196, 82, 26, GIFT_MOTIF_ALPHA.max],
];

export const GIFT_MOTIF_POSITIONS_SMALL: [number, number, number, number][] = [
  [49, 1, 20, GIFT_MOTIF_ALPHA.max],
  [93, 12, 20, GIFT_MOTIF_ALPHA.max],
  [99, 42, 20, GIFT_MOTIF_ALPHA.max],
  [89, 86, 20, GIFT_MOTIF_ALPHA.max],
  [49, 97, 20, GIFT_MOTIF_ALPHA.max],
  [9, 86, 20, GIFT_MOTIF_ALPHA.max],
  [0, 42, 20, GIFT_MOTIF_ALPHA.max],
  [5, 12, 20, GIFT_MOTIF_ALPHA.max],
];

export function giftMotifLayout(small: boolean): {
  width: number;
  height: number;
  positions: [number, number, number, number][];
} {
  return small
    ? { ...GIFT_MOTIF_CANVAS_SMALL, positions: GIFT_MOTIF_POSITIONS_SMALL }
    : { ...GIFT_MOTIF_CANVAS, positions: GIFT_MOTIF_POSITIONS };
}

export function tintMotifSilhouette(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  color: string,
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

export function paintGiftMotif(
  image: CanvasImageSource,
  opts: {
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    width: number;
    height: number;
    positions: [number, number, number, number][];
    dpr: number;
    color?: string | null;
  },
): void {
  const { ctx, width, height, positions, dpr, color } = opts;
  for (const [x, y, size, alpha] of positions) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, x * dpr, y * dpr, size * dpr, size * dpr);
  }
  ctx.globalAlpha = 1;
  if (color) tintMotifSilhouette(ctx, color, width * dpr, height * dpr);
}
