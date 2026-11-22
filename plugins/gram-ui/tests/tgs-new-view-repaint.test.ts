/**
 * @jest-environment jsdom
 */

jest.mock('../src/utils/animated-renderer/media-workers', () => ({
  getMediaWorkers: () => [],
  MAX_WORKERS: 1,
  respawnWorker: jest.fn(),
}));

import { TgsRenderer } from '../src/utils/animated-renderer/tgs-renderer';

describe('TgsRenderer view mounted into a running instance', () => {
  let initSpy: jest.SpyInstance;
  let heartbeatSpy: jest.SpyInstance;
  let contextSpy: jest.SpyInstance;

  beforeAll(() => {
    initSpy = jest.spyOn(TgsRenderer.prototype as any, 'initRenderer').mockImplementation(() => {});
    heartbeatSpy = jest.spyOn(TgsRenderer.prototype as any, 'startHeartbeat').mockImplementation(() => {});
    contextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const ctx = {
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
      };
      (this as any).__testCtx = ctx;
      return ctx as any;
    });
  });

  afterAll(() => {
    initSpy.mockRestore();
    heartbeatSpy.mockRestore();
    contextSpy.mockRestore();
  });

  function makeRenderer(frameIndexes: number[]): any {
    const r: any = new (TgsRenderer as any)('tgs://anim', 'emojipack-1:19', { size: 19 });
    const frame = { close: jest.fn(), width: 19, height: 19 } as any;
    r.frames = [frame, frame];
    r.framesCount = 2;
    r.emptyFrameIndexes = new Set(frameIndexes);
    r.prevFrameIndex = 0;
    r.approxFrameIndex = 0;
    r.isAnimating = true;
    r.isWaiting = false;
    r.cacheModulo = 0;
    r.speed = 1;
    r.direction = 1;
    r.msPerFrame = 1000 / 60;
    r.lastRenderAt = undefined;
    return r;
  }

  test('a view added while the frame index is unchanged still paints and loads', () => {
    const r = makeRenderer([]);
    const onLoad = jest.fn();
    r.addView('fresh', document.createElement('div'), onLoad);
    const view = r.views.get('fresh');

    r.stepFrame();

    expect(view.isDirty).toBe(false);
    expect((view.canvas as any).__testCtx.drawImage).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(view.isLoaded).toBe(true);
  });

  test('an empty frame does not drop the sticky visible-paint state', () => {
    const r = makeRenderer([0]);
    const onLoad = jest.fn();
    const ctx = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
    };
    const view: any = {
      canvas: { width: 19, height: 19, getContext: () => ctx },
      ctx,
      isLoaded: false,
      hasVisiblePaint: true,
      isDirty: true,
      onLoad,
    };
    r.views.set('reused', view);

    r.stepFrame();

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(view.hasVisiblePaint).toBe(true);

    ctx.clearRect.mockClear();
    ctx.drawImage.mockClear();
    view.isLoaded = true;
    view.isDirty = true;
    r.prevFrameIndex = 0;
    r.approxFrameIndex = 0;
    r.lastRenderAt = undefined;

    r.stepFrame();

    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
