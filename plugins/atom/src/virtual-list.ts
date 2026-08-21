import { useState, useEffect, useRef, useCallback } from './hooks.js';
import type { VNode } from './vdom.js';

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
    className,
    style,
    id,
  } = raw;

  const dynamicMode = itemHeight == null;
  const estH = itemHeight ?? estHUser ?? 60;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const pendingScrollRef = useRef(-1);
  const scrollRafRef = useRef(0);
  const [measuredH, setMeasuredH] = useState(ch ?? 600);
  const measuredHRef = useRef(ch ?? 600);

  const [measTick, setMeasTick] = useState(0);
  const measureRefsRef = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  const endReachedRef = useRef(false);
  const nearTopFiredRef = useRef(false);
  const readyFired = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const userScrolledRef = useRef(false);
  const suppressScrollRef = useRef(false);
  const atBottomRef = useRef(false);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const scrollToFiredRef = useRef(false);
  const dragRef = useRef({ dragging: false, dragY: 0, dragTop: 0 });

  const st = useRef<{
    heights: number[];
    prevLen: number;
    lastST: number;
    lastSH: number;
    prevST: number;
    heightsVersion: number;
    prefix: Float64Array | null;
    prefixLen: number;
    prefixVersion: number;
    anchor?: { key: string; top: number };
  }>({
    heights: [],
    prevLen: 0,
    lastST: 0,
    lastSH: 0,
    prevST: -1,
    heightsVersion: 0,
    prefix: null,
    prefixLen: -1,
    prefixVersion: -1,
    anchor: undefined,
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
        st.current.anchor = { key, top: r.top };
        return;
      }
    }
    st.current.anchor = undefined;
  }

  function updateThumb() {
    const el = containerRef.current;
    const t = thumbRef.current;
    if (!el || !t) return;
    const ch = el.clientHeight;
    if (ch === 0) return;
    const sh = el.scrollHeight;
    if (sh <= ch) {
      t.style.display = 'none';
      return;
    }
    t.style.display = 'block';
    const thumbH = Math.max(ch * 0.12, (ch / sh) * ch);
    const maxT = ch - thumbH;
    t.style.height = thumbH + 'px';
    t.style.top = Math.round((el.scrollTop / (sh - ch)) * maxT) + 'px';
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

  if (dynamicMode) {
    const len = data.length;
    if (len !== st.current.prevLen) {
      const itemsAdded = len > st.current.prevLen && st.current.prevLen > 0;
      if (itemsAdded) {
        const added = len - st.current.prevLen;
        const shifted = new Array(len).fill(0);
        for (let i = 0; i < st.current.prevLen; i++) shifted[i + added] = st.current.heights[i] || 0;
        st.current.heights = shifted;
        st.current.heightsVersion++;
        const anchor = st.current.anchor;
        const oldSH = st.current.lastSH;
        const oldST = st.current.lastST;
        queueMicrotask(() => {
          const el = containerRef.current;
          if (!el) return;
          if (anchor && anchor.key && el.scrollTop === oldST) {
            const node = el.querySelector<HTMLElement>('[data-vl-key="' + anchor.key + '"]');
            if (node) {
              const r = node.getBoundingClientRect();
              const diff = r.top - anchor.top;
              if (diff !== 0) {
                suppressScrollRef.current = true;
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
            suppressScrollRef.current = true;
            el.scrollTop = oldST + diff;
            st.current.lastST = el.scrollTop;
            st.current.lastSH = el.scrollHeight;
          }
        });
      } else {
        st.current.heights = new Array(len).fill(0);
        st.current.heightsVersion++;
      }
      st.current.prevLen = len;
    }
  }

  function getHeight(i: number): number {
    if (!dynamicMode) return itemHeight!;
    return i < st.current.heights.length && st.current.heights[i] > 0
      ? st.current.heights[i]
      : estH;
  }

  function ensurePrefix(): Float64Array {
    const s = st.current;
    const len = data.length;
    if (s.prefix && s.prefixLen === len && s.prefixVersion === s.heightsVersion) return s.prefix;
    const prefix = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + getHeight(i);
    s.prefix = prefix;
    s.prefixLen = len;
    s.prefixVersion = s.heightsVersion;
    return prefix;
  }

  function totalHeight(): number {
    if (!dynamicMode) return data.length * itemHeight!;
    return ensurePrefix()[data.length];
  }

  function computeVisibleRange(): { start: number; end: number } {
    const len = data.length;
    if (len === 0 || containerHeight <= 0) return { start: 0, end: len };
    const stPos = Math.max(0, Math.min(scrollTop, vh - containerHeight));
    if (dynamicMode) {
      const prefix = ensurePrefix();
      const minBuffer = overscan;
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
    let start = Math.max(0, Math.floor(stPos / itemHeight!) - overscan);
    let end = Math.min(len, Math.ceil((stPos + containerHeight) / itemHeight!) + overscan);
    if (end - start < initialNumToRender && len > 0) {
      end = Math.min(len, start + initialNumToRender);
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
  }, [scrollTop, containerHeight, data.length, vh, estH, overscan, initialNumToRender, dynamicMode, itemHeight, measTick, onVisibleRangeChange]);

  const handleScroll = useCallback((e: Event) => {
    const el = e.target as HTMLElement;
    const newSH = el.scrollHeight;

    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      st.current.lastST = el.scrollTop;
      st.current.lastSH = el.scrollHeight;
    } else {
      userScrolledRef.current = true;
      if (newSH !== st.current.lastSH && st.current.lastSH > 0) {
        const diff = newSH - st.current.lastSH;
        const nearBottom = st.current.lastST > 50 && st.current.lastST + el.clientHeight >= st.current.lastSH - 50;
        if (nearBottom) {
          el.scrollTop = newSH;
        } else {
          el.scrollTop = st.current.lastST + diff;
        }
      }
    }

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
    if (!el || userScrolledRef.current) return;
    const maxTop = el.scrollHeight - el.clientHeight;
    if (maxTop <= 0) return;
    // While the user hasn't scrolled, keep the view pinned to the bottom.
    // Re-runs as batches arrive and row heights settle from estimates to
    // measured, so the chat opens already at the bottom with no visible
    // intermediate scroll positions.
    suppressScrollRef.current = true;
    el.scrollTop = maxTop;
    st.current.lastST = maxTop;
    st.current.lastSH = el.scrollHeight;
    atBottomRef.current = true;
    setScrollTop(maxTop);
    updateThumb();
  }, [data.length, startAtBottom, measTick, vh, containerHeight]);

  useEffect(() => {
    if (scrollToKey == null || scrollToFiredRef.current) return;
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
      const ki = parseInt(k, 10);
      if (!isNaN(ki) && ki >= 0 && ki < data.length) idx = ki;
    }
    if (idx < 0) return;

    scrollToFiredRef.current = true;
    const pos = dynamicMode ? ensurePrefix()[idx] : idx * itemHeight!;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const target = Math.max(0, Math.min(pos, maxTop));
    suppressScrollRef.current = true;
    el.scrollTop = target;
    st.current.lastST = el.scrollTop;
    st.current.lastSH = el.scrollHeight;
    setScrollTop(el.scrollTop);
    updateThumb();
    requestAnimationFrame(() => {
      const node = el.querySelector<HTMLElement>('[data-vl-key="' + k + '"]');
      if (node) {
        node.scrollIntoView({ block: 'start' });
      } else {
        scrollToFiredRef.current = false;
      }
      updateThumb();
    });
  }, [scrollToKey, data.length, containerHeight]);

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
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, []);

  const items: VNode[] = [];

  function makeItemVNode(item: T, i: number, withRef: boolean): VNode {
    const vnode = renderItem({ item, index: i });
    const k = keyExtractor ? keyExtractor(item, i) : (vnode.key ?? i);
    vnode.key = k;
    const prev = vnode.props;
    const extraProps: Record<string, any> = { 'data-vl-key': String(k) };
    if (withRef && dynamicMode) {
      const idx = i;
      let refCb = measureRefsRef.current.get(idx);
      if (!refCb) {
        refCb = (el2: HTMLDivElement | null) => {
          if (!el2) return;
          const h = el2.offsetHeight;
          if (h > 0 && st.current.heights[idx] !== h) {
            st.current.heights[idx] = h;
            st.current.heightsVersion++;
            setMeasTick((t) => t + 1);
          }
        };
        measureRefsRef.current.set(idx, refCb);
      }
      extraProps.ref = refCb;
    }
    vnode.props = { ...prev, ...extraProps };
    return vnode;
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
    const rEnd = visibleEndIndex > visibleStartIndex
      ? visibleEndIndex
      : Math.min(data.length, initialNumToRender);
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

  const containerStyle: Record<string, any> = {
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'none',
  };
  if (ch != null) {
    containerStyle.height = ch + 'px';
  } else {
    containerStyle.flex = 1;
    containerStyle.alignSelf = 'stretch';
    containerStyle.minHeight = 0;
  }

  const wrapperStyle: Record<string, any> = {
    position: 'relative',
    flex: 1,
    display: 'flex',
    minHeight: 0,
    alignSelf: 'stretch',
    ...(style || {}),
  };

  function onContainerRef(el: HTMLDivElement | null) {
    containerRef.current = el;
    if (el && !readyFired.current) {
      readyFired.current = true;
      if (ch == null && typeof ResizeObserver !== 'undefined') {
        resizeObserverRef.current = new ResizeObserver(() => {
          const h = el.clientHeight;
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
      queueMicrotask(() => {
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        if (startAtBottom && data.length > 0 && el.scrollTop === 0 && el.scrollHeight > 0) {
          suppressScrollRef.current = true;
          el.scrollTop = el.scrollHeight;
          st.current.lastST = el.scrollTop;
          st.current.lastSH = el.scrollHeight;
          atBottomRef.current = true;
          setScrollTop(el.scrollTop);
        }
        updateThumb();
        updateAnchor(el);
        onReadyContent?.(el);
      });
    }
  }

  function onThumbRef(el: HTMLDivElement | null) {
    thumbRef.current = el;
    if (el && !(el as any).__thumbBound) {
      (el as any).__thumbBound = true;
      el.addEventListener('mousedown', onThumbDown);
    }
  }

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
