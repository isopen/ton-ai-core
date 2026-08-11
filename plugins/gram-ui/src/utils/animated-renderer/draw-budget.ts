const MAX_DRAW_CALLS_PER_WINDOW = 300;
const DRAW_WINDOW_MS = 14;

let drawCallsInWindow = 0;
let drawWindowStartedAt = 0;

export function resetDrawBudgetIfExpired(now: number) {
  if (now - drawWindowStartedAt >= DRAW_WINDOW_MS) {
    drawWindowStartedAt = now;
    drawCallsInWindow = 0;
  }
}

export function tryAcquireDrawCall(): boolean {
  if (drawCallsInWindow >= MAX_DRAW_CALLS_PER_WINDOW) return false;
  drawCallsInWindow++;
  return true;
}
