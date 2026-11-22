/**
 * @jest-environment jsdom
 */

jest.mock('../src/utils/animated-renderer/media-workers', () => ({
  getMediaWorkers: () => [],
  MAX_WORKERS: 1,
  respawnWorker: jest.fn(),
}));

jest.mock('../src/utils/animated-renderer/tick-coordinator', () => ({
  registerTickClient: jest.fn(() => jest.fn()),
  setTickClientHost: jest.fn(),
}));

import { TgsRenderer } from '../src/utils/animated-renderer/tgs-renderer';
import { setTickClientHost } from '../src/utils/animated-renderer/tick-coordinator';

describe('TgsRenderer tick host lifetime', () => {
  let heartbeatSpy: jest.SpyInstance;
  let initSpy: jest.SpyInstance;

  beforeAll(() => {
    heartbeatSpy = jest.spyOn(TgsRenderer.prototype as any, 'startHeartbeat').mockImplementation(() => {});
    initSpy = jest.spyOn(TgsRenderer.prototype as any, 'initRenderer').mockImplementation(() => {});
  });

  afterAll(() => {
    heartbeatSpy.mockRestore();
    initSpy.mockRestore();
  });

  function attach(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    return canvas;
  }

  function makeRenderer(): any {
    const r: any = new (TgsRenderer as any)('tgs://anim', 'emojipack-1:19', { size: 19 });
    r.isLooping = true;
    r.tickUnregister = jest.fn();
    return r;
  }

  beforeEach(() => {
    (setTickClientHost as jest.Mock).mockClear();
  });

  test('pickHostCanvas skips a detached canvas', () => {
    const r = makeRenderer();
    const detached = document.createElement('canvas');
    const live = attach();
    r.views.set('old', { canvas: detached });
    r.views.set('new', { canvas: live });

    expect(r.pickHostCanvas()).toBe(live);
    live.remove();
  });

  test('removeView refreshes the tick host when the current host goes away', () => {
    const r = makeRenderer();
    const host = attach();
    const other = attach();
    r.views.set('host', { canvas: host });
    r.views.set('other', { canvas: other, isSharedCanvas: true });

    host.remove();
    r.removeView('host');

    expect(setTickClientHost).toHaveBeenCalledWith(r.tickUnregister, null);
    other.remove();
  });

  test('starting an already looping renderer refreshes the tick host', () => {
    const r = makeRenderer();
    const live = attach();
    r.views.set('live', { canvas: live });

    r.startLoop();

    expect(setTickClientHost).toHaveBeenCalledWith(r.tickUnregister, live);
    live.remove();
  });
});
