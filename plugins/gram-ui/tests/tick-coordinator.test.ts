/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { registerTickClient, resetTickHostObserver, setTickClientHost, setTickScheduler, tickClientCount } from '../src/utils/animated-renderer/tick-coordinator';
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

describe('tick-coordinator viewport pause', () => {
  let queued: Array<() => void>;
  const fakes: Array<{ cb: (list: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void; targets: Set<Element> }> = [];

  class FakeIO {
    cb: (list: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void;
    targets = new Set<Element>();
    constructor(cb: (list: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void) {
      this.cb = cb;
      fakes.push(this);
    }
    observe(t: Element) { this.targets.add(t); }
    unobserve(t: Element) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    takeRecords() { return []; }
  }

  function observerFor(el: Element) {
    for (let i = fakes.length - 1; i >= 0; i--) {
      if (fakes[i].targets.has(el)) return fakes[i];
    }
    return null;
  }

  beforeEach(() => {
    resetTickHostObserver();
    (globalThis as any).IntersectionObserver = FakeIO;
    queued = [];
    setTickScheduler(
      (cb) => { queued.push(cb); return queued.length; },
      () => { },
    );
  });

  afterEach(() => {
    resetTickHostObserver();
    delete (globalThis as any).IntersectionObserver;
    setTickScheduler(null, null);
  });

  test('host outside viewport skips fn but keeps client', () => {
    const el = document.createElement('canvas');
    document.body.appendChild(el);
    let runs = 0;
    const un = registerTickClient(() => { runs++; return true; }, el);
    assert.equal(queued.length, 1);
    const obs = observerFor(el);
    assert.ok(obs, 'host must be observed');
    obs?.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]);
    queued[0]();
    assert.equal(runs, 1);
    obs?.cb([{ target: el, isIntersecting: false, intersectionRatio: 0 }]);
    queued[0]();
    assert.equal(runs, 1);
    assert.equal(tickClientCount(), 1, 'client must stay registered while hidden');
    assert.equal(queued.length, 2, 'fully hidden tick must not reschedule an extra raf');
    un();
    assert.equal(tickClientCount(), 0);
  });

  test('hidden client wakes up when scrolled back into view', () => {
    const el = document.createElement('canvas');
    document.body.appendChild(el);
    let runs = 0;
    const un = registerTickClient(() => { runs++; return true; }, el);
    const obs = observerFor(el);
    obs?.cb([{ target: el, isIntersecting: false, intersectionRatio: 0 }]);
    queued[0]();
    assert.equal(runs, 0);
    obs?.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]);
    assert.equal(queued.length, 2, 'visibility restore must wake the tick loop');
    queued[1]();
    assert.equal(runs, 1);
    un();
    assert.equal(tickClientCount(), 0);
  });

  test('detached host is skipped until host is re-set', () => {
    const el = document.createElement('canvas');
    document.body.appendChild(el);
    let runs = 0;
    const un = registerTickClient(() => { runs++; return true; }, el);
    el.remove();
    queued[0]();
    assert.equal(runs, 0, 'detached canvas must not draw');
    assert.equal(tickClientCount(), 1);
    const el2 = document.createElement('canvas');
    document.body.appendChild(el2);
    setTickClientHost(un, el2);
    assert.equal(queued.length, 2, 'setTickClientHost must wake the loop');
    queued[1]();
    assert.equal(runs, 1, 'canvas re-attached via setTickClientHost resumes drawing');
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
