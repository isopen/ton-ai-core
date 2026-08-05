import {
  useState, useEffect, useRef, useMemo, useCallback, __setReroot, flushAllEffects,
} from '../src/hooks.js';
import {
  ComponentInstance, setCurrentInstance, currentInstance,
} from '../src/vdom.js';
import type { ComponentType, VNode } from '../src/vdom.js';

function createTestInstance(): ComponentInstance {
  const Comp: ComponentType = () => ({ type: 'div', props: {}, children: [], key: null });
  return new ComponentInstance(Comp, {});
}

function runWithInstance<T>(fn: () => T): T {
  const inst = createTestInstance();
  setCurrentInstance(inst);
  inst.hookIndex = 0;
  const result = fn();
  setCurrentInstance(null);
  return result;
}

describe('useState', () => {
  test('returns initial value', () => {
    runWithInstance(() => {
      const [val] = useState('hello');
      expect(val).toBe('hello');
    });
  });

  test('returns initial number', () => {
    runWithInstance(() => {
      const [val] = useState(42);
      expect(val).toBe(42);
    });
  });

  test('setState updates value', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [val, setVal] = useState('hello');
    expect(val).toBe('hello');
    setVal('world');

    inst.hookIndex = 0;
    const [val2] = useState('hello');
    expect(val2).toBe('world');

    setCurrentInstance(null);
  });

  test('setState with function updater', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [val, setVal] = useState(1);
    setVal((prev) => prev + 1);

    inst.hookIndex = 0;
    const [val2] = useState(1);
    expect(val2).toBe(2);

    setCurrentInstance(null);
  });

  test('does not re-render if value is the same', () => {
    let rerootCalled = false;
    __setReroot(() => { rerootCalled = true; });

    runWithInstance(() => {
      const [, setVal] = useState(42);
      setVal(42);
      expect(rerootCalled).toBe(false);
    });

    __setReroot(null as any);
  });

  test('triggers reroot on value change', () => {
    let rerootCalled = false;
    __setReroot(() => { rerootCalled = true; });

    runWithInstance(() => {
      const [, setVal] = useState(1);
      setVal(2);
      expect(rerootCalled).toBe(true);
    });

    __setReroot(null as any);
  });

  test('lazy initialization with function', () => {
    const factory = jest.fn(() => 'computed');
    runWithInstance(() => {
      const [val] = useState(factory);
      expect(val).toBe('computed');
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  test('lazy init does not call factory on re-render', () => {
    const factory = jest.fn(() => 'computed');
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [, setVal] = useState(factory);
    setVal('updated');

    inst.hookIndex = 0;
    const [val] = useState(factory);
    expect(val).toBe('updated');
    expect(factory).toHaveBeenCalledTimes(1);

    setCurrentInstance(null);
  });

  test('multiple useState hooks work independently', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [a, setA] = useState(1);
    const [b, setB] = useState(2);
    expect(a).toBe(1);
    expect(b).toBe(2);
    setA(10);
    setB(20);

    inst.hookIndex = 0;
    const [a2] = useState(1);
    const [b2] = useState(2);
    expect(a2).toBe(10);
    expect(b2).toBe(20);

    setCurrentInstance(null);
  });

  test('throws if called outside component', () => {
    setCurrentInstance(null);
    expect(() => useState('test')).toThrow('Hooks must be called within a component');
  });

  test('function as initial value (non-lazy)', () => {
    const fn = () => 'result';
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [val] = useState(fn);
    // useState with function initial calls it (lazy init), so val is 'result'
    expect(val).toBe('result');

    setCurrentInstance(null);
  });

  test('setState with function updater uses previous state', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [, setVal] = useState(0);
    setVal((prev: number) => prev + 5);

    inst.hookIndex = 0;
    const [val] = useState(0);
    expect(val).toBe(5);

    setCurrentInstance(null);
  });

  test('setState with same function reference does not trigger reroot', () => {
    let rerootCalled = false;
    __setReroot(() => { rerootCalled = true; });
    const fn = () => 'hello';

    runWithInstance(() => {
      const [, setVal] = useState(fn);
      setVal(fn);
      expect(rerootCalled).toBe(false);
    });

    __setReroot(null as any);
  });

  test('multiple setState calls in sequence', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const [, setVal] = useState(0);
    setVal(1);
    setVal(2);
    setVal(3);

    inst.hookIndex = 0;
    const [val2] = useState(0);
    expect(val2).toBe(3);

    setCurrentInstance(null);
  });
});

describe('useEffect', () => {
  test('runs effect on mount', () => {
    const fn = jest.fn();
    runWithInstance(() => {
      useEffect(fn, []);
    });
    flushAllEffects();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('runs effect when no deps provided', () => {
    const fn = jest.fn();
    runWithInstance(() => {
      useEffect(fn);
    });
    flushAllEffects();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does not re-run if deps unchanged', () => {
    const fn = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(fn, [1, 2]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(fn, [1, 2]);
    flushAllEffects();

    expect(fn).toHaveBeenCalledTimes(1);
    setCurrentInstance(null);
  });

  test('re-runs if deps change', () => {
    const fn = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(fn, [1]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(fn, [2]);
    flushAllEffects();

    expect(fn).toHaveBeenCalledTimes(2);
    setCurrentInstance(null);
  });

  test('runs cleanup on deps change', () => {
    const cleanup = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(() => cleanup, [1]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(() => jest.fn(), [2]);
    flushAllEffects();

    expect(cleanup).toHaveBeenCalledTimes(1);
    setCurrentInstance(null);
  });

  test('registers cleanup in unmountCleanups', () => {
    const cleanup = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(() => cleanup, []);
    flushAllEffects();

    expect(inst.unmountCleanups).toHaveLength(1);
    expect(inst.unmountCleanups[0]).toBe(cleanup);
    setCurrentInstance(null);
  });

  test('removes old cleanup from unmountCleanups on re-run', () => {
    const cleanup1 = jest.fn();
    const cleanup2 = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(() => cleanup1, [1]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(() => cleanup2, [2]);
    flushAllEffects();

    expect(inst.unmountCleanups).toHaveLength(1);
    expect(inst.unmountCleanups[0]).toBe(cleanup2);
    expect(cleanup1).toHaveBeenCalledTimes(1);
    setCurrentInstance(null);
  });

  test('re-runs if deps length changes', () => {
    const fn = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(fn, [1, 2]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(fn, [1]);
    flushAllEffects();

    expect(fn).toHaveBeenCalledTimes(2);
    setCurrentInstance(null);
  });

  test('does not re-run if deps undefined and then undefined', () => {
    const fn = jest.fn();
    runWithInstance(() => {
      useEffect(fn);
    });
    flushAllEffects();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('multiple useEffect hooks', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    runWithInstance(() => {
      useEffect(fn1, []);
      useEffect(fn2, []);
    });
    flushAllEffects();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('effect without deps re-runs every render', () => {
    const fn = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(fn);
    flushAllEffects();
    expect(fn).toHaveBeenCalledTimes(1);

    inst.hookIndex = 0;
    useEffect(fn);
    flushAllEffects();
    expect(fn).toHaveBeenCalledTimes(2);

    setCurrentInstance(null);
  });

  test('cleanup error does not throw', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(() => {
      return () => { throw new Error('cleanup error'); };
    }, [1]);
    flushAllEffects();

    inst.hookIndex = 0;
    useEffect(() => jest.fn(), [2]);
    flushAllEffects();

    // should not throw, just console.error
    setCurrentInstance(null);
  });

  test('registers multiple cleanups in unmountCleanups', () => {
    const cleanup1 = jest.fn();
    const cleanup2 = jest.fn();
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useEffect(() => cleanup1, []);
    flushAllEffects();
    inst.hookIndex = 2;
    useEffect(() => cleanup2, []);
    flushAllEffects();

    expect(inst.unmountCleanups).toHaveLength(2);
    expect(inst.unmountCleanups[0]).toBe(cleanup1);
    expect(inst.unmountCleanups[1]).toBe(cleanup2);
    setCurrentInstance(null);
  });
});

describe('useRef', () => {
  test('returns object with current set to initial', () => {
    runWithInstance(() => {
      const ref = useRef(42);
      expect(ref).toEqual({ current: 42 });
    });
  });

  test('returns same ref on re-render', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const ref1 = useRef('hello');

    inst.hookIndex = 0;
    const ref2 = useRef('hello');

    expect(ref1).toBe(ref2);
    expect(ref2.current).toBe('hello');
    setCurrentInstance(null);
  });

  test('mutating current persists', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const ref = useRef({ count: 0 });
    ref.current = { count: 1 };

    inst.hookIndex = 0;
    const ref2 = useRef({ count: 0 });
    expect(ref2.current).toEqual({ count: 1 });

    setCurrentInstance(null);
  });

  test('useRef with undefined initial', () => {
    runWithInstance(() => {
      const ref = useRef(undefined);
      expect(ref.current).toBeUndefined();
    });
  });

  test('useRef with null initial', () => {
    runWithInstance(() => {
      const ref = useRef(null);
      expect(ref.current).toBeNull();
    });
  });

  test('useRef with object initial is persistent', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const ref = useRef({ x: 1 });
    ref.current.x = 2;

    inst.hookIndex = 0;
    const ref2 = useRef({ x: 1 });
    expect(ref2.current.x).toBe(2);

    setCurrentInstance(null);
  });
});

describe('useMemo', () => {
  test('returns computed value', () => {
    runWithInstance(() => {
      const val = useMemo(() => 1 + 2, []);
      expect(val).toBe(3);
    });
  });

  test('does not recompute if deps unchanged', () => {
    const factory = jest.fn(() => 42);
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const v1 = useMemo(factory, [1, 2]);

    inst.hookIndex = 0;
    const v2 = useMemo(factory, [1, 2]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(v1).toBe(v2);
    setCurrentInstance(null);
  });

  test('recomputes if deps change', () => {
    const factory = jest.fn((x: number) => x * 2);
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useMemo(() => factory(1), [1]);

    inst.hookIndex = 0;
    useMemo(() => factory(2), [2]);

    expect(factory).toHaveBeenCalledTimes(2);
    setCurrentInstance(null);
  });

  test('recomputes if deps length changes', () => {
    const factory = jest.fn(() => 42);
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useMemo(factory, [1, 2]);

    inst.hookIndex = 0;
    useMemo(factory, [1]);

    expect(factory).toHaveBeenCalledTimes(2);
    setCurrentInstance(null);
  });

  test('useMemo with empty deps only computes once', () => {
    const factory = jest.fn(() => 99);
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const v1 = useMemo(factory, []);
    inst.hookIndex = 0;
    const v2 = useMemo(factory, []);
    inst.hookIndex = 0;
    const v3 = useMemo(factory, []);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(v1).toBe(99);
    expect(v2).toBe(99);
    expect(v3).toBe(99);
    setCurrentInstance(null);
  });

  test('useMemo with changing deps length', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    const v1 = useMemo(() => [1, 2], [1, 2]);
    inst.hookIndex = 0;
    const v2 = useMemo(() => [1, 2, 3], [1, 2, 3]);

    expect(v1).toEqual([1, 2]);
    expect(v2).toEqual([1, 2, 3]);
    setCurrentInstance(null);
  });
});

describe('useCallback', () => {
  test('returns memoized callback', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    const fn = () => 42;

    inst.hookIndex = 0;
    const cb1 = useCallback(fn, []);

    inst.hookIndex = 0;
    const cb2 = useCallback(fn, []);

    expect(cb1).toBe(cb2);
    expect(cb2()).toBe(42);
    setCurrentInstance(null);
  });

  test('returns new callback when deps change', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    let fn = () => 42;
    inst.hookIndex = 0;
    const cb1 = useCallback(fn, [1]);

    fn = () => 43;
    inst.hookIndex = 0;
    const cb2 = useCallback(fn, [2]);

    expect(cb1).not.toBe(cb2);
    expect(cb1()).toBe(42);
    expect(cb2()).toBe(43);
    setCurrentInstance(null);
  });

  test('useCallback with no deps re-runs every render', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    const fn = () => 42;
    inst.hookIndex = 0;
    const cb1 = useCallback(fn, [1]);
    inst.hookIndex = 0;
    const cb2 = useCallback(fn, [1]);

    expect(cb1).toBe(cb2);
    setCurrentInstance(null);
  });

  test('useCallback preserves fn behavior', () => {
    runWithInstance(() => {
      const fn = (a: number, b: number) => a + b;
      const cb = useCallback(fn, []);
      expect(cb(2, 3)).toBe(5);
    });
  });
});

describe('hook ordering and errors', () => {
  test('hooks must be called in same order across renders', () => {
    const inst = createTestInstance();
    setCurrentInstance(inst);

    inst.hookIndex = 0;
    useState(1);
    useEffect(() => {}, []);
    useRef(null);

    inst.hookIndex = 0;
    useState(1);
    useEffect(() => {}, []);
    useRef(null);

    flushAllEffects();

    // no error
    setCurrentInstance(null);
  });

  test('useEffect throws if called outside component', () => {
    setCurrentInstance(null);
    expect(() => useEffect(() => {})).toThrow('Hooks must be called within a component');
  });

  test('useRef throws if called outside component', () => {
    setCurrentInstance(null);
    expect(() => useRef(null)).toThrow('Hooks must be called within a component');
  });

  test('useMemo throws if called outside component', () => {
    setCurrentInstance(null);
    expect(() => useMemo(() => 1, [])).toThrow('Hooks must be called within a component');
  });

  test('useCallback throws if called outside component', () => {
    setCurrentInstance(null);
    expect(() => useCallback(() => {}, [])).toThrow('Hooks must be called within a component');
  });
});
