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
  startAtBottom?: boolean;
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
    startAtBottom,
    className,
    style,
    id,
  } = raw;

  const dynamicMode = itemHeight == null;
  const estH = itemHeight ?? estHUser ?? 60;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredH, setMeasuredH] = useState(ch ?? 600);
  const endReachedRef = useRef(false);
  const nearTopFiredRef = useRef(false);
  const readyFired = useRef(false);

  const st = useRef<{
    heights: number[];
    prevLen: number;
    lastST: number;
    lastSH: number;
    prevST: number;
  }>({
    heights: [],
    prevLen: 0,
    lastST: 0,
    lastSH: 0,
    prevST: -1,
  });

  const containerHeight = ch ?? measuredH;

  if (dynamicMode) {
    const len = data.length;
    if (len !== st.current.prevLen) {
      const itemsAdded = len > st.current.prevLen && st.current.prevLen > 0;
      if (itemsAdded) {
        const added = len - st.current.prevLen;
        const shifted = new Array(len).fill(0);
        for (let i = 0; i < st.current.prevLen; i++) shifted[i + added] = st.current.heights[i] || 0;
        st.current.heights = shifted;
        const oldSH = st.current.lastSH;
        const oldST = st.current.lastST;
        queueMicrotask(() => {
          const el = containerRef.current;
          if (el && oldSH > 0) {
            const diff = el.scrollHeight - oldSH;
            el.scrollTop = oldST + diff;
            st.current.lastST = el.scrollTop;
            st.current.lastSH = el.scrollHeight;
          }
        });
      } else {
        st.current.heights = new Array(len).fill(0);
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

  function totalHeight(): number {
    if (!dynamicMode) return data.length * itemHeight!;
    let h = 0;
    for (let i = 0; i < data.length; i++) h += getHeight(i);
    return h;
  }

  const vh = totalHeight();

  let visibleStartIndex = 0;
  let visibleEndIndex = data.length;
  let topHeight = 0;
  let bottomHeight = 0;

  if (data.length > 0 && containerHeight > 0) {
    const stPos = Math.max(0, Math.min(scrollTop, vh - containerHeight));

    if (dynamicMode) {
      const minBuffer = overscan;
      const fillBuffer = Math.ceil(containerHeight / estH);
      const buffer = Math.max(minBuffer, fillBuffer);
      const visibleTop = Math.max(0, stPos - buffer * estH);

      let acc = 0;
      visibleStartIndex = 0;
      for (let i = 0; i < data.length; i++) {
        const hi = getHeight(i);
        if (acc + hi > visibleTop) {
          visibleStartIndex = Math.max(0, i - buffer);
          break;
        }
        acc += hi;
      }

      visibleEndIndex = visibleStartIndex;
      acc = 0;
      for (let i = 0; i < visibleStartIndex; i++) acc += getHeight(i);
      while (visibleEndIndex < data.length && acc < stPos + containerHeight + buffer * estH) {
        acc += getHeight(visibleEndIndex);
        visibleEndIndex++;
      }
      visibleEndIndex = Math.min(data.length, visibleEndIndex + buffer);

      topHeight = 0;
      for (let i = 0; i < visibleStartIndex; i++) topHeight += getHeight(i);
      bottomHeight = 0;
      for (let i = visibleEndIndex; i < data.length; i++) bottomHeight += getHeight(i);
    } else {
      visibleStartIndex = Math.max(0, Math.floor(stPos / itemHeight!) - overscan);
      visibleEndIndex = Math.min(data.length, Math.ceil((stPos + containerHeight) / itemHeight!) + overscan);

      const visibleCount = visibleEndIndex - visibleStartIndex;
      if (visibleCount < initialNumToRender && data.length > 0) {
        visibleEndIndex = Math.min(data.length, visibleStartIndex + initialNumToRender);
      }

      topHeight = visibleStartIndex * itemHeight!;
      bottomHeight = (data.length - visibleEndIndex) * itemHeight!;
    }
  }

  const handleScroll = useCallback((e: Event) => {
    const el = e.target as HTMLElement;
    const newSH = el.scrollHeight;

    if (newSH !== st.current.lastSH && st.current.lastSH > 0) {
      const diff = newSH - st.current.lastSH;
      const nearBottom = st.current.lastST > 50 && st.current.lastST + el.clientHeight >= st.current.lastSH - 50;
      if (nearBottom) {
        el.scrollTop = newSH;
      } else {
        el.scrollTop = st.current.lastST + diff;
      }
    }

    st.current.lastST = el.scrollTop;
    st.current.lastSH = el.scrollHeight;

    if (dynamicMode) {
      const d = Math.abs(el.scrollTop - st.current.prevST);
      if (d > estH / 2 || st.current.prevST < 0) {
        st.current.prevST = el.scrollTop;
        setScrollTop(el.scrollTop);
      }
    } else {
      setScrollTop(el.scrollTop);
    }

    if (el.scrollTop < 80) {
      if (!nearTopFiredRef.current) {
        nearTopFiredRef.current = true;
        onNearTop?.();
      }
    } else if (el.scrollTop > 200) {
      nearTopFiredRef.current = false;
    }
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

  const items: VNode[] = [];

  function makeItemVNode(item: T, i: number, withRef: boolean): VNode {
    const vnode = renderItem({ item, index: i });
    const k = keyExtractor ? keyExtractor(item, i) : (vnode.key ?? i);
    vnode.key = k;
    if (withRef && dynamicMode) {
      const idx = i;
      const prev = vnode.props;
      vnode.props = {
        ...prev,
        ref: (el2: HTMLDivElement | null) => {
          if (el2 && el2.offsetHeight > 0 && st.current.heights[idx] !== el2.offsetHeight) {
            st.current.heights[idx] = el2.offsetHeight;
          }
        },
      };
    }
    return vnode;
  }

  if (dynamicMode && data.length > 0) {
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
    ...style,
  };
  if (ch != null) {
    containerStyle.height = ch + 'px';
  } else {
    containerStyle.flex = 1;
    containerStyle.alignSelf = 'stretch';
    containerStyle.minHeight = 0;
  }

  function onContainerRef(el: HTMLDivElement | null) {
    containerRef.current = el;
    if (el && !readyFired.current) {
      readyFired.current = true;
      queueMicrotask(() => {
        st.current.lastST = el.scrollTop;
        st.current.lastSH = el.scrollHeight;
        if (startAtBottom && data.length > 0 && el.scrollTop === 0 && el.scrollHeight > 0) {
          el.scrollTop = el.scrollHeight;
        }
        onReadyContent?.(el);
      });
    }
  }

  const props: Record<string, any> = {
    ref: onContainerRef,
    style: containerStyle,
    onScroll: handleScroll,
  };
  if (id) props.id = id;
  if (className) props.className = className;

  return { type: 'div', props, children: items, key: null };
}
