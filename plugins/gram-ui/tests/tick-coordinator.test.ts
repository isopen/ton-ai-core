/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { registerTickClient, setTickScheduler, tickClientCount } from '../src/utils/animated-renderer/tick-coordinator';
import { shouldFullCacheFrames, createPaintRateState, notePaintLatency, skipPaintTick } from '../src/utils/animated-renderer/frame-cache-policy';

describe('tick-coordinator', () => {
  let queued: Array<() => void>;
  let cancels: number;

  beforeEach(() => {
    queued = [];
    cancels = 0;
    setTickScheduler(
      (cb) => { queued.push(cb); return queued.length; },
      () => { cancels++; },
    );
  });

  afterEach(() => {
    setTickScheduler(null, null);
  });

  test('many clients share a single scheduled tick', () => {
    let runs = 0;
    const un1 = registerTickClient(() => { runs++; return true; });
    const un2 = registerTickClient(() => { runs++; return true; });
    const un3 = registerTickClient(() => { runs++; return true; });
    assert.equal(queued.length, 1);
    assert.equal(tickClientCount(), 3);
    queued[0]();
    assert.equal(runs, 3);
    assert.equal(queued.length, 2);
    un1();
    un2();
    un3();
    assert.equal(tickClientCount(), 0);
  });

  test('client returning false is removed without extra ticks', () => {
    let runs = 0;
    registerTickClient(() => { runs++; return false; });
    assert.equal(queued.length, 1);
    queued[0]();
    assert.equal(runs, 1);
    assert.equal(tickClientCount(), 0);
    assert.equal(queued.length, 1);
  });

  test('throwing client is dropped', () => {
    registerTickClient(() => { throw new Error('x'); });
    const un = registerTickClient(() => true);
    queued[0]();
    assert.equal(tickClientCount(), 1);
    un();
    assert.equal(tickClientCount(), 0);
  });
});

describe('shouldFullCacheFrames', () => {
  test('small emoji animations fit', () => {
    assert.equal(shouldFullCacheFrames(60, 45), true);
  });

  test('single frame never needs full cache', () => {
    assert.equal(shouldFullCacheFrames(1, 45), false);
  });

  test('large long animations stay windowed', () => {
    assert.equal(shouldFullCacheFrames(180, 512), false);
  });

  test('rejects non-finite input', () => {
    assert.equal(shouldFullCacheFrames(NaN, 45), false);
    assert.equal(shouldFullCacheFrames(60, 0), false);
  });
});

describe('paint rate adaptation', () => {
  test('halves after three slow frames, restores after eight fast', () => {
    const s = createPaintRateState();
    notePaintLatency(s, 100, 16, 60);
    notePaintLatency(s, 100, 16, 60);
    assert.equal(s.halved, false);
    notePaintLatency(s, 100, 16, 60);
    assert.equal(s.halved, true);
    for (let i = 0; i < 7; i++) {
      notePaintLatency(s, 5, 16, 60);
      assert.equal(s.halved, true);
    }
    notePaintLatency(s, 5, 16, 60);
    assert.equal(s.halved, false);
  });

  test('middle zone resets streaks without flapping', () => {
    const s = createPaintRateState();
    notePaintLatency(s, 100, 16, 60);
    notePaintLatency(s, 100, 16, 60);
    notePaintLatency(s, 20, 16, 60);
    notePaintLatency(s, 100, 16, 60);
    notePaintLatency(s, 100, 16, 60);
    assert.equal(s.halved, false);
  });

  test('static animations never halve', () => {
    const s = createPaintRateState();
    for (let i = 0; i < 10; i++) notePaintLatency(s, 500, 16, 1);
    assert.equal(s.halved, false);
    assert.equal(skipPaintTick(s, 1), false);
  });

  test('skip alternates only while halved', () => {
    const s = createPaintRateState();
    assert.equal(skipPaintTick(s, 60), false);
    for (let i = 0; i < 3; i++) notePaintLatency(s, 100, 16, 60);
    assert.equal(skipPaintTick(s, 60), true);
    assert.equal(skipPaintTick(s, 60), false);
    assert.equal(skipPaintTick(s, 60), true);
  });
});
