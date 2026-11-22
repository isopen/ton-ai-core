/**
 * @jest-environment jsdom
 */

jest.mock('../src/utils/animated-renderer/media-workers', () => ({
  getMediaWorkers: () => [],
  MAX_WORKERS: 1,
  respawnWorker: jest.fn(),
}));

import { TgsRenderer } from '../src/utils/animated-renderer/tgs-renderer';
import type { AnimatedRendererView } from '../src/utils/animated-renderer/types';

function makeCtx(): any {
  return {
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
  };
}

function makeView(overrides: Partial<AnimatedRendererView> = {}) {
  const ctx = makeCtx();
  const canvas = { width: 19, height: 19, getContext: () => ctx } as any;
  const view: AnimatedRendererView = { canvas, ctx, ...overrides };
  return { view, ctx };
}

describe('TgsRenderer transparent first frame', () => {
  let initSpy: jest.SpyInstance;
  let heartbeatSpy: jest.SpyInstance;

  beforeAll(() => {
    initSpy = jest.spyOn(TgsRenderer.prototype as any, 'initRenderer').mockImplementation(() => {});
    heartbeatSpy = jest.spyOn(TgsRenderer.prototype as any, 'startHeartbeat').mockImplementation(() => {});
  });

  afterAll(() => {
    initSpy.mockRestore();
    heartbeatSpy.mockRestore();
  });

  function makeRenderer(): any {
    const r: any = new (TgsRenderer as any)('tgs://anim', 'emojipack-1:19', { size: 19 });
    const frame = { close: jest.fn(), width: 19, height: 19 } as any;
    r.frames = [frame, frame];
    r.framesCount = 2;
    r.emptyFrameIndexes = new Set([0]);
    r.prevFrameIndex = -1;
    r.approxFrameIndex = 0;
    r.isAnimating = true;
    r.cacheModulo = 0;
    r.speed = 1;
    r.direction = 1;
    r.msPerFrame = 1000 / 60;
    r.lastRenderAt = undefined;
    r.hasVisiblePaint = true;
    return r;
  }

  test('a newly mounted view still gets its first paint and onLoad on an empty frame', () => {
    const r = makeRenderer();
    const onLoad = jest.fn();
    const painted = makeView({ isLoaded: true, hasVisiblePaint: true });
    const fresh = makeView({ isLoaded: false, hasVisiblePaint: false, onLoad });
    r.views.set('painted', painted.view);
    r.views.set('fresh', fresh.view);

    r.stepFrame();

    expect(painted.ctx.drawImage).not.toHaveBeenCalled();
    expect(fresh.ctx.clearRect).toHaveBeenCalledWith(0, 0, 19, 19);
    expect(fresh.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(fresh.view.isLoaded).toBe(true);
    expect(fresh.view.hasVisiblePaint).toBe(false);
  });

  test('an already painted view keeps its pixels on a later empty frame', () => {
    const r = makeRenderer();
    const loaded = makeView({ isLoaded: true, hasVisiblePaint: true });
    r.views.set('loaded', loaded.view);

    r.stepFrame();

    expect(loaded.ctx.clearRect).not.toHaveBeenCalled();
    expect(loaded.ctx.drawImage).not.toHaveBeenCalled();
  });
});
