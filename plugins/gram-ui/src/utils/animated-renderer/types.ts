export interface AnimatedRendererParams {
  size: number;
  noLoop?: boolean;
  quality?: number;
  isLowPriority?: boolean;
  coords?: { x: number; y: number };
}

export interface AnimatedRendererView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  isLoaded?: boolean;
  isPaused?: boolean;
  isSharedCanvas?: boolean;
  isDirty?: boolean;
  coords?: { x: number; y: number };
  prevScaledCoords?: { x: number; y: number };
  onLoad?: () => void;
  onError?: () => void;
  onFrame?: (index: number) => void;
}

export interface IAnimatedRenderer {
  isPlaying(): boolean;
  play(viewId?: string): void;
  pause(viewId?: string): void;
  setSpeed(speed: number): void;
  setNoLoop(noLoop?: boolean): void;
  setSharedCanvasCoords(viewId: string, coords: { x: number; y: number }): void;
  removeView(viewId: string): void;
  destroy(): void;
}
