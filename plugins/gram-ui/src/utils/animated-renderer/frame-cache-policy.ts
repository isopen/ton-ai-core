export const FULL_FRAME_CACHE_MAX_BYTES = 6 * 1024 * 1024;

export function shouldFullCacheFrames(framesCount: number, imgSize: number): boolean {
  if (!Number.isFinite(framesCount) || !Number.isFinite(imgSize)) return false;
  if (framesCount <= 1 || imgSize <= 0) return false;
  return framesCount * imgSize * imgSize * 4 <= FULL_FRAME_CACHE_MAX_BYTES;
}

export interface PaintRateState {
  slowStreak: number;
  fastStreak: number;
  halved: boolean;
  phase: boolean;
}

export function createPaintRateState(): PaintRateState {
  return { slowStreak: 0, fastStreak: 0, halved: false, phase: false };
}

export function notePaintLatency(state: PaintRateState, latMs: number, frameMs: number, framesCount: number): void {
  if (!Number.isFinite(latMs) || !Number.isFinite(frameMs) || frameMs <= 0) return;
  if (!Number.isFinite(framesCount) || framesCount <= 1) return;
  if (latMs > frameMs * 3) {
    state.slowStreak++;
    state.fastStreak = 0;
    if (!state.halved && state.slowStreak >= 3) {
      state.halved = true;
      state.phase = false;
    }
  } else if (latMs < frameMs) {
    state.fastStreak++;
    state.slowStreak = 0;
    if (state.halved && state.fastStreak >= 8) state.halved = false;
  } else {
    state.slowStreak = 0;
    state.fastStreak = 0;
  }
}

export function skipPaintTick(state: PaintRateState, framesCount: number): boolean {
  if (!state.halved || !Number.isFinite(framesCount) || framesCount <= 1) return false;
  state.phase = !state.phase;
  return state.phase;
}
