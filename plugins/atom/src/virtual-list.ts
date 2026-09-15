import { useState, useEffect, useRef, useCallback, useMemo } from './hooks.js';
import type { VNode } from './vdom.js';
import { getLogger } from '@ton-ai/gram-debug';

const vlDiagLog = getLogger('atom:vlist');

export interface VirtualListProps<T> {
  data: T[];
  renderItem: (info: { item: T; index: number }) => VNode;
  keyExtractor?: (item: T, index: number) => string | number;
  itemHeight?: number;
  estimatedItemHeight?: number;
  overscan?: number;
  containerHeight?: number;
  initialNumToRender?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onNearTop?: () => void;
  onReadyContent?: (el: HTMLDivElement) => void;
  onVisibleRangeChange?: (start: number, end: number) => void;
  startAtBottom?: boolean;
  scrollToKey?: string | number;
  topLoader?: VNode;

  estimateItem?: (item: T, index: number) => number;
  className?: string;
  style?: Record<string, any>;
  id?: string;
}

export function VirtualList<T>(raw: VirtualListProps<T>): VNode {
  const {
    data,
    renderItem,
    keyExtractor,
    itemHeight,
    estimatedItemHeight: estHUser,
    containerHeight: ch,
    overscan = 3,
    initialNumToRender = 10,
    onEndReached,
    onEndReachedThreshold = 0.5,
    onNearTop,
    onReadyContent,
    onVisibleRangeChange,
    startAtBottom,
    scrollToKey,
    topLoader,
    estimateItem,
    className,
    style,
    id,
  } = raw;

  const dynamicMode = itemHeight == null;
  const estH = itemHeight ?? estHUser ?? 60;
  const safeOverscan = Math.max(0, Math.min(Number.isFinite(overscan) ? overscan : 3, 50));
  const safeInitial = Math.max(1, Math.min(Number.isFinite(initialNumToRender) ? initialNumToRender : 10, 100));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const pendingScrollRef = useRef(-1);
  const scrollRafRef = useRef(0);
  const [measuredH, setMeasuredH] = useState(ch ?? 600);
  const measuredHRef = useRef(ch ?? 600);

  const [measTick, setMeasTick] = useState(0);
  const measureRefsRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const keyByIndexRef = useRef<string[]>([]);

  function vlKeyOf(item: T, index: number): string {
    if (keyExtractor) {
      try {
        return String(keyExtractor(item, index));
      } catch {}
    }
    return String(index);
  }

  function vlEscapeKey(key: string): string {
    try {
      if (typeof window !== 'undefined') {
        const w = window as unknown as { CSS?: { escape?: (v: string) => string } };
        if (w.CSS && typeof w.CSS.escape === 'function') return w.CSS.escape(key);
      }
    } catch {}
    return key.replace(/["\\\[\]]/g, '\\$&');
  }

  function vlKeysSignature(): string {
    const len = data.length;
    if (len === 0) return '0';
    const first = vlKeyOf(data[0], 0);
    const last = vlKeyOf(data[len - 1], len - 1);
    const mid = vlKeyOf(data[len >> 1], len >> 1);
    const q = vlKeyOf(data[(len >> 2)], (len >> 2));
    return len + '|' + first + '|' + q + '|' + mid + '|' + last;
  }
  const endReachedRef = useRef(false);
  const nearTopFiredRef = useRef(false);
  const readyFired = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const observedRowsRef = useRef<Map<string, Element>>(new Map());
  const userScrolledRef = useRef(false);
  const suppressUntilRef = useRef(0);
  const lastPinKeyRef = useRef('');
  const atBottomRef = useRef(false);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const scrollToFiredRef = useRef(false);
  const dragRef = useRef({ dragging: false, dragY: 0, dragTop: 0 });

  const observedElRef = useRef<HTMLDivElement | null>(null);
  const scrollToRetryRef = useRef(0);
  const firstPaintRef = useRef(true);

  function pruneCaches(alive: Set<string>): boolean {
    let pruned = false;
    for (const k of [...st.current.heights.keys()]) {
      if (!alive.has(k)) {
        st.current.heights.delete(k);
        pruned = true;
      }
    }
    const refs = measureRefsRef.current;
    for (const k of [...refs.keys()]) {
      if (!alive.has(k)) refs.delete(k);
    }
    if (pruned) st.current.heightsVersion++;
    return pruned;
  }

  const st = useRef<{
    heights: Map<string, number>;
    prevKeys: string;
    prevLen: number;
    prevData: unknown;
    lastST: number;
    lastSH: number;
    prevST: number;
    heightsVersion: number;
    prefix: Float64Array | null;
    prefixData: unknown;
    prefixLen: number;
    prefixVersion: number;
    prefixEst: number;
    prefixEstimator: unknown;
    anchor?: { key: string; top: number };
    wasAtBottom: boolean;
  }>({
    heights: new Map(),
    prevKeys: '',
    prevLen: 0,
    prevData: null,
    lastST: 0,
    lastSH: 0,
    prevST: -1,
    heightsVersion: 0,
    prefix: null,
    prefixData: null,
    prefixLen: -1,
    prefixVersion: -1,
    prefixEst: -1,
    prefixEstimator: null,
    anchor: undefined,
    wasAtBottom: true,
  });

  const containerHeight = ch ?? measuredH;

  function updateAnchor(el: HTMLElement) {
    const er = el.getBoundingClientRect();
    const children = el.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      if (!child.getAttribute) continue;
      const key = child.getAttribute('data-vl-key');
      if (!key) continue;
      const r = child.getBoundingClientRect();
      if (r.bottom > er.top + 2) {
        st.current.anchor = { key, top: r.top - er.top };
        return;
      }
    }
    st.current.anchor = undefined;
  }

  const thumbCacheRef = useRef({ display: '', height: '', top: '' });
  const measRafRef = useRef(0);

  function scheduleMeasTick() {
    if (measRafRef.current) return;
    measRafRef.current = requestAnimationFrame(() => {
      measRafRef.current = 0;
      setMeasTick((t) => t + 1);
    });
  }

  function ensureRowObserver(): ResizeObserver | null {
    if (rowObserverRef.current) return rowObserverRef.current;
    if (typeof ResizeObserver === 'undefined') return null;
    try {
      const ro = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const keyAttr = target.getAttribute ? target.getAttribute('data-vl-key') : null;
          if (!keyAttr) continue;
          const h = target.offsetHeight;
          if (h > 0 && st.current.heights.get(keyAttr) !== h) {
            st.current.heights.set(keyAttr, h);
            changed = true;
          }
        }
        if (changed) {
          st.current.heightsVersion++;
          scheduleMeasTick();
        }
      });
      rowObserverRef.current = ro;
      return ro;
    } catch {
      return null;
    }
  }

  function updateThumb() {
    const el = containerRef.current;
    const t = thumbRef.current;
    if (!el || !t) return;
    const cache = thumbCacheRef.current;
    const ch = el.clientHeight;
    if (ch === 0) return;
    const sh = el.scrollHeight;
    if (sh <= ch) {
      if (cache.display !== 'none') {
        cache.display = 'none';
        t.style.display = 'none';
      }
      return;
    }
    const thumbH = Math.max(ch * 0.12, (ch / sh) * ch);
    const maxT = ch - thumbH;
    const heightStr = thumbH + 'px';
    const topStr = Math.round((el.scrollTop / (sh - ch)) * maxT) + 'px';
    if (cache.display !== 'block') {
      cache.display = 'block';
      t.style.display = 'block';
    }
    if (cache.height !== heightStr) {
      cache.height = heightStr;
      t.style.height = heightStr;
    }
    if (cache.top !== topStr) {
      cache.top = topStr;
      t.style.top = topStr;
    }
  }

  const programmaticTopRef = useRef(-1);

  function armSuppress(top?: number) {
    suppressUntilRef.current = Date.now() + 150;
    programmaticTopRef.current = top != null && Number.isFinite(top) ? top : -1;
  }

  function onThumbMove(e: MouseEvent) {
    const el = containerRef.current;
    const t = thumbRef.current;
    if (!el || !t) return;
    const dy = e.clientY - dragRef.current.dragY;
    const ch = el.clientHeight;
    const hh = t.clientHeight;
    const maxT = ch - hh;
    const newTop = Math.max(0, Math.min(maxT, dragRef.current.dragTop + dy));
    thumbCacheRef.current.top = newTop + 'px';
    t.style.top = newTop + 'px';
    if (maxT > 0) el.scrollTop = (newTop / maxT) * (el.scrollHeight - el.clientHeight);
  }

  function onThumbUp() {
    dragRef.current.dragging = false;
    document.removeEventListener('mousemove', onThumbMove);
    document.removeEventListener('mouseup', onThumbUp);
  }

  function onThumbDown(e: MouseEvent) {
    e.preventDefault();
    dragRef.current.dragging = true;
    dragRef.current.dragY = e.clientY;
    dragRef.current.dragTop = parseInt((thumbRef.current?.style.top || '0'), 10);
    document.addEventListener('mousemove', onThumbMove);
    document.addEventListener('mouseup', onThumbUp);
  }

  function vlAliveKeys(len: number): Set<string> {
    const alive = new Set<string>();
    for (let i = 0; i < len; i++) {
      alive.add(vlKeyOf(data[i], i));
      if (!keyExtractor) {
        const mapped = keyByIndexRef.current[i];
        if (mapped !== undefined) alive.add(mapped);
      }
    }
    return alive;
  }

  if (dynamicMode) {
    const len = data.length;
    const refChanged = data !== st.current.prevData;
    if (refChanged) st.current.prevData = data;
    const sig = vlKeysSignature();
    if (sig !== st.current.prevKeys || refChanged) {
      const grew = len > st.current.prevLen && st.current.prevLen > 0;
      if (grew) {
        pruneCaches(vlAliveKeys(len));
        const anchor = st.current.anchor;
        const oldSH = st.current.lastSH;
        const oldST = st.current.lastST;
        const wasAtBottom = st.current.wasAtBottom;
        queueMicrotask(() => {
          const el = containerRef.current;
          if (!el) return;

          if (wasAtBottom && el.scrollTop === oldST) {
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            if (el.scrollTop !== maxTop) {
              armSuppress(maxTop);
              el.scrollTop = maxTop;
              vlDiagLog.info('[pollscroll] vl-appended-pin len=' + data.length + ' st=' + Math.round(el.scrollTop) + ' maxTop=' + Math.round(maxTop));
            }
            st.current.lastST = el.scrollTop;
            st.current.lastSH = el.scrollHeight;
            atBottomRef.current = true;
            st.current.wasAtBottom = true;
            setScrollTop(el.scrollTop);
            updateThumb();
            return;
          }
          if (anchor && anchor.key && el.scrollTop === oldST) {
            const node = el.querySelector<HTMLElement>('[data-vl-key="' + vlEscapeKey(anchor.key) + '"]');
            if (node) {
              const er = el.getBoundingClientRect();
              const r = node.getBoundingClientRect();
              const diff = (r.top - er.top) - anchor.top;
              if (diff !== 0) {
                armSuppress(el.scrollTop + diff);
                el.scrollTop = el.scrollTop + diff;
                st.current.lastST = el.scrollTop;
                st.current.lastSH = el.scrollHeight;
                atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
              }
              updateAnchor(el);
              return;
            }
          }
          if (oldSH > 0 && el.scrollTop === oldST) {
            const diff = el.scrollHeight - oldSH;
            if (diff !== 0) {
              armSuppress(oldST + diff);
              el.scrollTop = oldST + diff;
            }
            st.current.lastST = el.scrollTop;
            st.current.lastSH = el.scrollHeight;
          }
        });
      } else if (sig !== st.current.prevKeys || st.current.heights.size > len || len === 0) {
        pruneCaches(vlAliveKeys(len));
        if (len === 0) st.current.heightsVersion++;
      }
      st.current.prevKeys = sig;
      st.current.prevLen = len;
    }
  }

  function getHeight(i: number): number {
    if (!dynamicMode) return itemHeight!;
    const item = data[i];
    if (item !== undefined) {
      if (!keyExtractor) {
        const mapped = keyByIndexRef.current[i];
        if (mapped !== undefined) {
          const mk = st.current.heights.get(mapped);
          if (mk != null && mk > 0) return mk;
        }
      }
      const known = st.current.heights.get(vlKeyOf(item, i));
      if (known != null && known > 0) return known;
      if (estimateItem) {
        try {
          const est = estimateItem(item, i);
          if (Number.isFinite(est) && est > 0) return est;
        } catch {}
      }
    }
    return estH;
  }

  function ensurePrefix(): Float64Array {
    const s = st.current;
    const len = data.length;
    if (s.prefix && s.prefixData === data && s.prefixLen === len && s.prefixVersion === s.heightsVersion && s.prefixEst === estH && s.prefixEstimator === estimateItem) return s.prefix;
    const prefix = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + getHeight(i);
    s.prefix = prefix;
    s.prefixData = data;
    s.prefixLen = len;
    s.prefixVersion = s.heightsVersion;
    s.prefixEst = estH;
    s.prefixEstimator = estimateItem;
    return prefix;
  }

  const TOP_LOADER_H = 48;

  function totalHeight(): number {
    const base = !dynamicMode ? data.length * itemHeight! : ensurePrefix()[data.length];
    return base + (topLoader ? TOP_LOADER_H : 0);
  }

  function computeVisibleRange(): { start: number; end: number } {
    const len = data.length;
    if (len === 0 || containerHeight <= 0) return { start: 0, end: len };
    const rawPos = Math.max(0, Math.min(scrollTop, totalHeight() - containerHeight));
    const stPos = Math.max(0, rawPos - (topLoader ? TOP_LOADER_H : 0));
    if (dynamicMode) {
      const prefix = ensurePrefix();
      const minBuffer = safeOverscan;
      const fillBuffer = Math.ceil(containerHeight / estH);
      const buffer = Math.max(minBuffer, Math.min(fillBuffer, 4));
      const visibleTop = Math.max(0, stPos - buffer * estH);

      let lo = 0;
      let hi = len;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (prefix[mid] <= visibleTop) lo = mid;
        else hi = mid - 1;
      }
      const start = Math.max(0, lo - buffer);

      const target = stPos + containerHeight + buffer * estH;
      let lo2 = start;
      let hi2 = len;
      while (lo2 < hi2) {
        const mid = (lo2 + hi2) >> 1;
        if (prefix[mid] < target) lo2 = mid + 1;
        else hi2 = mid;
      }
      const end = Math.min(len, lo2 + buffer);
      return { start, end };
    }
    let start = Math.max(0, Math.floor(stPos / itemHeight!) - safeOverscan);
    let end = Math.min(len, Math.ceil((stPos + containerHeight) / itemHeight!) + safeOverscan);
    if (end - start < safeInitial && len > 0) {
      end = Math.min(len, start + safeInitial);
    }
    return { start, end };
  }

  const vh = totalHeight();

  const visibleRange = computeVisibleRange();
  const visibleStartIndex = visibleRange.start;
  const visibleEndIndex = visibleRange.end;
  let topHeight = 0;
  let bottomHeight = 0;
  if (dynamicMode) {
    const prefix = ensurePrefix();
    topHeight = prefix[visibleStartIndex];
    bottomHeight = prefix[data.length] - prefix[visibleEndIndex];
  } else {
    topHeight = visibleStartIndex * itemHeight!;
    bottomHeight = (data.length - visibleEndIndex) * itemHeight!;
  }

  const lastRangeRef = useRef('0,0');
  useEffect(() => {
    const { start, end } = computeVisibleRange();
    const k = start + ',' + end;
    if (k !== lastRangeRef.current) {
      lastRangeRef.current = k;
      onVisibleRangeChange?.(start, end);
    }
  }, [scrollTop, containerHeight, data.length, vh, estH, safeOverscan, safeInitial, dynamicMode, itemHeight, measTick, onVisibleRangeChange]);

  const handleScroll = useCallback((e: Event) => {
    const el = e.target as HTMLElement;
    const newSH = el.scrollHeight;

    const suppressed = Date.now() < suppressUntilRef.current;
    const expected = programmaticTopRef.current;
    if (scrollToRetryRef.current !== 0) {
      if (Math.abs(el.scrollTop - st.current.lastST) > estH * 2) {
        if (scrollToRetryRef.current) cancelAnimationFrame(scrollToRetryRef.current);
        scrollToRetryRef.current = 0;
        userScrolledRef.current = true;
        suppressUntilRef.current = 0;
        programmaticTopRef.current = -1;
      } else {
        programmaticTopRef.current = el.scrollTop;
      }
    } else if (!suppressed || Math.abs(el.scrollTop - expected) > 1) {
      userScrolledRef.current = true;
      if (suppressed) {
        suppressUntilRef.current = 0;
        programmaticTopRef.current = -1;
      }
    } else {
      programmaticTopRef.current = -1;
    }

    st.current.wasAtBottom = el.scrollTop + el.clientHeight >= newSH - 2;

    st.current.lastST = el.scrollTop;
    st.current.lastSH = el.scrollHeight;

    if (dynamicMode) {
      const d = Math.abs(el.scrollTop - st.current.prevST);
      if (d > estH / 2 || st.current.prevST < 0) {
        st.current.prevST = el.scrollTop;
        pendingScrollRef.current = el.scrollTop;
      }
    } else {
      pendingScrollRef.current = el.scrollTop;
    }

    if (el.scrollTop < 80) {
      if (!nearTopFiredRef.current) {
        nearTopFiredRef.current = true;
        onNearTop?.();
      }
    } else if (el.scrollTop > 200) {
      nearTopFiredRef.current = false;
    }

    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const v = pendingScrollRef.current;
      pendingScrollRef.current = -1;
      if (v >= 0) setScrollTop(v);
      if (el.isConnected) {
        if (dynamicMode) updateAnchor(el);
        updateThumb();
      }
    });
  }, [dynamicMode, estH, onNearTop]);

  useEffect(() => {
    if (!onEndReached || data.length === 0) return;
    const scrollBottom = scrollTop + containerHeight;
    const threshold = onEndReachedThreshold * containerHeight;
    if (scrollBottom + threshold >= vh) {
      if (!endReachedRef.current) {
        endReachedRef.current = true;
        onEndReached();
      }
    } else {
      endReachedRef.current = false;
    }
  }, [scrollTop, containerHeight, data.length, vh, onEndReached, onEndReachedThreshold]);

  useEffect(() => {
    if (!startAtBottom || data.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const pinKey = data.length + '|' + st.current.prevKeys + '|' + (startAtBottom ? 1 : 0) + '|' + containerHeight;
    if (pinKey !== lastPinKeyRef.current) {
      lastPinKeyRef.current = pinKey;
      if (userScrolledRef.current && !st.current.wasAtBottom) return;
      const maxTop = el.scrollHeight - el.clientHeight;
      if (maxTop <= 0) {
        if (el.scrollTop !== 0) {
          armSuppress(0);
          el.scrollTop = 0;
        }
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        atBottomRef.current = true;
        st.current.wasAtBottom = true;
        setScrollTop(el.scrollTop);
        updateThumb();
        return;
      }
      if (el.scrollTop !== maxTop) {
        armSuppress(maxTop);
        el.scrollTop = maxTop;
        vlDiagLog.info('[pollscroll] vl-pin len=' + data.length + ' st=' + Math.round(el.scrollTop) + ' maxTop=' + Math.round(maxTop));
      }
      st.current.lastST = el.scrollTop;
      st.current.lastSH = el.scrollHeight;
      atBottomRef.current = true;
      st.current.wasAtBottom = true;
      setScrollTop(el.scrollTop);
      updateThumb();
      return;
    }
    const a = st.current.anchor;
    if (a && a.key && el.scrollTop === st.current.lastST) {
      let node: HTMLElement | null = null;
      try {
        node = el.querySelector<HTMLElement>('[data-vl-key="' + vlEscapeKey(a.key) + '"]');
      } catch {
        node = null;
      }
      if (node) {
        const er = el.getBoundingClientRect();
        const r = node.getBoundingClientRect();
        const diff = (r.top - er.top) - a.top;
        if (diff !== 0 && Number.isFinite(diff)) {
          armSuppress(el.scrollTop + diff);
          el.scrollTop = el.scrollTop + diff;
          vlDiagLog.info('[pollscroll] vl-anchor key=' + a.key + ' diff=' + Math.round(diff) + ' st=' + Math.round(el.scrollTop));
        }
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        st.current.wasAtBottom = atBottomRef.current;
        setScrollTop(el.scrollTop);
        updateAnchor(el);
        updateThumb();
        return;
      }
      const oldSH = st.current.lastSH;
      if (oldSH > 0 && el.scrollTop === st.current.lastST) {
        const diff = el.scrollHeight - oldSH;
        if (diff !== 0) {
          armSuppress(el.scrollTop + diff);
          el.scrollTop = el.scrollTop + diff;
        }
      }
    }
    st.current.lastST = el.scrollTop;
    st.current.lastSH = el.scrollHeight;
    updateThumb();
  }, [data, data.length, startAtBottom, measTick, vh, containerHeight]);

  const scrollToSeenRef = useRef<string | number | null>(null);
  const scrollToIdxRef = useRef(-1);
  useEffect(() => {
    if (scrollToKey == null) {
      scrollToSeenRef.current = null;
      scrollToIdxRef.current = -1;
      scrollToFiredRef.current = false;
      return;
    }
    if (scrollToSeenRef.current !== scrollToKey) {
      scrollToSeenRef.current = scrollToKey;
      scrollToFiredRef.current = false;
    }
    const el = containerRef.current;
    if (!el || data.length === 0 || el.clientHeight <= 0) return;
    const k = String(scrollToKey);
    let idx = -1;
    if (keyExtractor) {
      for (let i = 0; i < data.length; i++) {
        if (String(keyExtractor(data[i], i)) === k) {
          idx = i;
          break;
        }
      }
    } else {
      const trimmed = k.trim();
      const isStrictInt = /^\d+$/.test(trimmed) && String(Number(trimmed)) === trimmed;
      if (isStrictInt) {
        const ki = Number(trimmed);
        if (ki >= 0 && ki < data.length) idx = ki;
      }
      if (idx < 0) {
        const map = keyByIndexRef.current;
        for (let i = 0; i < map.length && i < data.length; i++) {
          if (map[i] === k) {
            idx = i;
            break;
          }
        }
      }
    }
    if (idx < 0) return;
    const rawPosEarly = dynamicMode ? ensurePrefix()[idx] : idx * itemHeight!;
    const posEarly = rawPosEarly + (topLoader ? TOP_LOADER_H : 0);
    if (scrollToFiredRef.current && idx === scrollToIdxRef.current) {
      const elEarly = containerRef.current;
      if (elEarly) {
        const maxEarly = Math.max(0, elEarly.scrollHeight - elEarly.clientHeight);
        const targetEarly = Math.max(0, Math.min(posEarly, maxEarly));
        if (Math.abs(elEarly.scrollTop - targetEarly) <= 1) return;
      } else {
        return;
      }
    }
    scrollToIdxRef.current = idx;

    scrollToFiredRef.current = true;
    const rawPos = dynamicMode ? ensurePrefix()[idx] : idx * itemHeight!;
    const pos = rawPos + (topLoader ? TOP_LOADER_H : 0);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const target = Math.max(0, Math.min(pos, maxTop));
    if (el.scrollTop !== target) {
      armSuppress(target);
      el.scrollTop = target;
      vlDiagLog.info('[pollscroll] vl-scrollToKey st=' + Math.round(el.scrollTop));
    }
    st.current.lastST = el.scrollTop;
    st.current.lastSH = el.scrollHeight;
    atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    st.current.wasAtBottom = atBottomRef.current;
    setScrollTop(el.scrollTop);
    updateThumb();
    if (scrollToRetryRef.current) cancelAnimationFrame(scrollToRetryRef.current);
    let attempts = 0;
    const retrySeek = () => {
      scrollToRetryRef.current = 0;
      if (!el.isConnected || containerRef.current !== el) {
        scrollToFiredRef.current = false;
        return;
      }
      const rePos = (dynamicMode ? ensurePrefix()[idx] : idx * itemHeight!) + (topLoader ? TOP_LOADER_H : 0);
      const reMax = Math.max(0, el.scrollHeight - el.clientHeight);
      const reTarget = Math.max(0, Math.min(rePos, reMax));
      if (el.scrollTop !== reTarget) {
        armSuppress(reTarget);
        el.scrollTop = reTarget;
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        setScrollTop(el.scrollTop);
      }
      let node: HTMLElement | null = null;
      try {
        node = el.querySelector<HTMLElement>('[data-vl-key="' + vlEscapeKey(k) + '"]');
      } catch {
        node = null;
      }
      if (!node && containerRef.current === el && scrollToSeenRef.current === scrollToKey && attempts < 8) {
        attempts++;
        scrollToFiredRef.current = false;
        scrollToRetryRef.current = requestAnimationFrame(retrySeek);
        return;
      }
      if (node) scrollToFiredRef.current = true;
      updateThumb();
    };
    scrollToRetryRef.current = requestAnimationFrame(retrySeek);
  }, [scrollToKey, data, data.length, containerHeight]);

  useEffect(() => {
    if (!dynamicMode) return;
    updateThumb();
  }, [data.length, vh, containerHeight, scrollTop]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
      if (measRafRef.current) {
        cancelAnimationFrame(measRafRef.current);
        measRafRef.current = 0;
      }
      if (scrollToRetryRef.current) {
        cancelAnimationFrame(scrollToRetryRef.current);
        scrollToRetryRef.current = 0;
      }
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false;
        document.removeEventListener('mousemove', onThumbMove);
        document.removeEventListener('mouseup', onThumbUp);
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (rowObserverRef.current) {
        rowObserverRef.current.disconnect();
        rowObserverRef.current = null;
      }
      observedRowsRef.current.clear();
    };
  }, []);

  const items: VNode[] = [];

  function makeItemVNode(item: T, i: number, withRef: boolean): VNode {
    const src = renderItem({ item, index: i });
    const k = keyExtractor ? keyExtractor(item, i) : (src.key ?? i);
    const prev = src.props;
    const keyStr = String(k);
    keyByIndexRef.current[i] = keyStr;
    const extraProps: Record<string, any> = { 'data-vl-key': keyStr };
    if (withRef && dynamicMode) {
      let refCb = measureRefsRef.current.get(keyStr);
      if (!refCb) {
        refCb = (el2: HTMLDivElement | null) => {
          const prevEl = observedRowsRef.current.get(keyStr);
          if (!el2) {
            if (prevEl && rowObserverRef.current) {
              try { rowObserverRef.current.unobserve(prevEl); } catch {}
            }
            observedRowsRef.current.delete(keyStr);
            return;
          }
          if (prevEl && prevEl !== el2 && rowObserverRef.current) {
            try { rowObserverRef.current.unobserve(prevEl); } catch {}
          }
          observedRowsRef.current.set(keyStr, el2);
          const h = el2.offsetHeight;
          if (h > 0 && st.current.heights.get(keyStr) !== h) {
            st.current.heights.set(keyStr, h);
            st.current.heightsVersion++;
            scheduleMeasTick();
          }
          const ro = ensureRowObserver();
          if (ro) {
            try { ro.observe(el2); } catch {}
          }
        };
        measureRefsRef.current.set(keyStr, refCb);
      }
      const userRef = (prev as Record<string, any>).ref;
      if (typeof userRef === 'function' || (userRef && typeof userRef === 'object')) {
        const measureCb = refCb;
        extraProps.ref = (el2: HTMLDivElement | null) => {
          measureCb(el2);
          try {
            if (typeof userRef === 'function') userRef(el2);
            else if (userRef && typeof userRef === 'object') userRef.current = el2;
          } catch {}
        };
      } else {
        extraProps.ref = refCb;
      }
    }
    const out: VNode = { ...src, key: k, props: { ...prev, ...extraProps } };
    return out;
  }

  const loaderNode: VNode | null = topLoader
    ? {
        type: 'div',
        props: {
          key: 'loader-top',
          style: 'position:sticky;top:0;z-index:3;height:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0;pointer-events:none',
        },
        children: [topLoader],
        key: 'loader-top',
      }
    : null;

  if (dynamicMode && data.length > 0) {
    if (loaderNode) items.push(loaderNode);
    if (topHeight > 0) {
      items.push({
        type: 'div',
        props: { key: 'spacer-top', style: 'height:' + topHeight + 'px;flex-shrink:0;pointer-events:none' },
        children: [],
        key: 'spacer-top',
      });
    }
    let rEnd = visibleEndIndex > visibleStartIndex
      ? visibleEndIndex
      : Math.min(data.length, safeInitial);
    if (firstPaintRef.current && rEnd - visibleStartIndex < safeInitial) {
      rEnd = Math.min(data.length, visibleStartIndex + safeInitial);
    }
    if (rEnd > visibleStartIndex) firstPaintRef.current = false;
    for (let i = visibleStartIndex; i < rEnd; i++) {
      items.push(makeItemVNode(data[i], i, true));
    }
    if (bottomHeight > 0) {
      items.push({
        type: 'div',
        props: { key: 'spacer-bottom', style: 'height:' + bottomHeight + 'px;flex-shrink:0;pointer-events:none' },
        children: [],
        key: 'spacer-bottom',
      });
    }
  } else if (!dynamicMode) {
    if (loaderNode) items.push(loaderNode);
    if (topHeight > 0) {
      items.push({
        type: 'div',
        props: { key: 'spacer-top', style: 'height:' + topHeight + 'px;flex-shrink:0;pointer-events:none' },
        children: [],
        key: 'spacer-top',
      });
    }
    for (let i = visibleStartIndex; i < visibleEndIndex; i++) {
      items.push(makeItemVNode(data[i], i, false));
    }
    if (bottomHeight > 0) {
      items.push({
        type: 'div',
        props: { key: 'spacer-bottom', style: 'height:' + bottomHeight + 'px;flex-shrink:0;pointer-events:none' },
        children: [],
        key: 'spacer-bottom',
      });
    }
  }

  if (keyByIndexRef.current.length > data.length) keyByIndexRef.current.length = data.length;

  const containerStyle: Record<string, any> = useMemo(() => {
    const s: Record<string, any> = {
      overflowY: 'auto',
      overflowX: 'hidden',
      scrollbarWidth: 'none',
    };
    if (ch != null) {
      s.height = ch + 'px';
    } else {
      s.flex = 1;
      s.alignSelf = 'stretch';
      s.minHeight = 0;
    }
    return s;
  }, [ch]);

  const wrapperStyle: Record<string, any> = {
    position: 'relative',
    flex: 1,
    display: 'flex',
    minHeight: 0,
    alignSelf: 'stretch',
    ...(style || {}),
  };

  const observedAutoRef = useRef(false);

  const onContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el) {
      observedElRef.current = null;
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      observedAutoRef.current = false;
    } else if (el !== observedElRef.current || (ch == null) !== observedAutoRef.current) {
      observedElRef.current = el;
      observedAutoRef.current = ch == null;
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (ch == null && typeof ResizeObserver !== 'undefined') {
        const target = el;
        resizeObserverRef.current = new ResizeObserver(() => {
          const h = target.clientHeight;
          if (h > 0 && h !== measuredHRef.current) {
            measuredHRef.current = h;
            setMeasuredH(h);
          }
          updateThumb();
        });
        resizeObserverRef.current.observe(el);
        if (el.clientHeight > 0) {
          measuredHRef.current = el.clientHeight;
          setMeasuredH(el.clientHeight);
        }
      }
    }
    if (el && !readyFired.current) {
      readyFired.current = true;
      queueMicrotask(() => {
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        st.current.wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        if (startAtBottom && data.length > 0 && el.scrollTop === 0 && el.scrollHeight > 0) {
          const maxTop = el.scrollHeight - el.clientHeight;
          if (maxTop > 0) {
            if (el.scrollTop !== maxTop) {
              armSuppress(maxTop);
              el.scrollTop = maxTop;
            }
          } else if (el.scrollTop !== 0) {
            armSuppress(0);
            el.scrollTop = 0;
          }
          st.current.lastST = el.scrollTop;
          st.current.lastSH = el.scrollHeight;
          atBottomRef.current = true;
          st.current.wasAtBottom = true;
          setScrollTop(el.scrollTop);
        }
        updateThumb();
        updateAnchor(el);
        onReadyContent?.(el);
      });
    }
  }, [ch, startAtBottom, onReadyContent]);

  const onThumbRef = useCallback((el: HTMLDivElement | null) => {
    thumbRef.current = el;
    if (el && !(el as any).__thumbBound) {
      (el as any).__thumbBound = true;
      el.addEventListener('mousedown', onThumbDown);
    }
  }, []);

  const scrollProps: Record<string, any> = {
    ref: onContainerRef,
    style: containerStyle,
    onScroll: handleScroll,
  };
  if (id) scrollProps.id = id;
  if (className) scrollProps.className = className;

  const thumbNode: VNode = {
    type: 'div',
    props: {
      ref: onThumbRef,
      class: 'CustomScrollbar-thumb',
      style: 'display:none;opacity:1',
    },
    children: [],
    key: 'custom-thumb',
  };

  return {
    type: 'div',
    props: { class: 'CustomScrollbar', style: wrapperStyle },
    children: [{ type: 'div', props: scrollProps, children: items, key: 'list' }, thumbNode],
    key: null,
  };
}
