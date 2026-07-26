import { h } from '@ton-ai/atom/jsx-runtime';
import { useRef, useState, useEffect } from '@ton-ai/atom/hooks';

interface CustomScrollbarProps {
  id?: string;
  className?: string;
  style?: any;
  maxHeight?: string;
  onScroll?: (e: Event) => void;
  onNearTop?: () => void;
  startAtBottom?: boolean;
  onReadyContent?: (el: HTMLDivElement) => void;
  children?: any;
  virtualItems?: any[];
  renderVirtualItem?: (item: any, index: number) => any;
  estimatedItemHeight?: number;
}

export function CustomScrollbar(props: CustomScrollbarProps) {
  const { id, className, style, maxHeight, onScroll, onNearTop, startAtBottom, onReadyContent, children, virtualItems, renderVirtualItem, estimatedItemHeight = 60 } = props;

  const isVirtual = !!(Array.isArray(virtualItems) && renderVirtualItem);
  const [scrollTop, setScrollTop] = useState(0);

  const s = useRef<{
    content: HTMLDivElement | null;
    thumb: HTMLDivElement | null;
    ro: ResizeObserver | null;
    ready: boolean;
    dragY: number;
    dragTop: number;
    _lastST: number;
    _lastSH: number;
    _prevST: number;
    heights: number[];
    _prevLen: number;
    _onScroll?: (e: Event) => void;
    _onNearTop?: () => void;
    _estH: number;
    _startAtBottom: boolean;
    _anchored: boolean;
  }>({
    content: null, thumb: null, ro: null, ready: false,
    dragY: 0, dragTop: 0,
    _lastST: 0, _lastSH: 0, _prevST: -1,
    heights: [],
    _prevLen: 0,
    _estH: estimatedItemHeight,
    _startAtBottom: !!startAtBottom,
    _anchored: false,
  });

  s.current._onScroll = onScroll;
  s.current._onNearTop = onNearTop;
  s.current._estH = estimatedItemHeight;
  s.current._startAtBottom = !!startAtBottom;

  function getHeight(i: number): number {
    return i < s.current.heights.length && s.current.heights[i] > 0
      ? s.current.heights[i]
      : estimatedItemHeight;
  }

  function totalHeight(): number {
    if (!isVirtual || !virtualItems) return 0;
    let h = 0;
    for (let i = 0; i < virtualItems.length; i++) h += getHeight(i);
    return h;
  }

  function update() {
    const c = s.current.content;
    const t = s.current.thumb;
    if (!c || !t) return;
    const ch = c.clientHeight;
    if (ch === 0) return;
    const sh = c.scrollHeight;
    if (sh <= ch) { t.style.display = 'none'; return; }
    t.style.display = 'block';
    const thumbH = Math.max(ch * 0.12, (ch / sh) * ch);
    const maxT = ch - thumbH;
    t.style.height = thumbH + 'px';
    t.style.top = Math.round((c.scrollTop / (sh - ch)) * maxT) + 'px';
  }

  function onMove(e: MouseEvent) {
    const c = s.current.content;
    const t = s.current.thumb;
    if (!c || !t) return;
    const dy = e.clientY - s.current.dragY;
    const ch = c.clientHeight;
    const hh = t.clientHeight;
    const maxT = ch - hh;
    const newTop = Math.max(0, Math.min(maxT, s.current.dragTop + dy));
    t.style.top = newTop + 'px';
    if (maxT > 0) c.scrollTop = (newTop / maxT) * (c.scrollHeight - c.clientHeight);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  function onThumbDown(e: MouseEvent) {
    e.preventDefault();
    s.current.dragY = e.clientY;
    s.current.dragTop = parseInt((s.current.thumb?.style.top || '0'), 10);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function init() {
    if (s.current.ready) return;
    const c = s.current.content;
    const t = s.current.thumb;
    if (!c || !t) return;
    s.current.ready = true;
    t.addEventListener('mousedown', onThumbDown);
    s.current.ro = new ResizeObserver(() => { update(); });
    s.current.ro.observe(c);
    s.current._lastST = c.scrollTop;
    s.current._lastSH = c.scrollHeight;
  }

  function handleScroll(e: Event) {
    const c = s.current.content;
    if (!c) return;
    s.current._lastST = c.scrollTop;
    s.current._lastSH = c.scrollHeight;
    if (isVirtual) {
      const diff = Math.abs(c.scrollTop - s.current._prevST);
      if (diff > s.current._estH / 2 || s.current._prevST < 0) {
        s.current._prevST = c.scrollTop;
        setScrollTop(c.scrollTop);
      }
    }
    update();
    if (c.scrollTop < 80) s.current._onNearTop?.();
    s.current._onScroll?.(e);
  }

  function anchor(el: HTMLDivElement) {
    const n = s.current;
    const prevST = n._lastST;
    const prevSH = n._lastSH;
    const newSH = el.scrollHeight;

    if (newSH > 0 && newSH !== prevSH) {
      if (prevSH > 0) {
        const diff = newSH - prevSH;
        const nearBottom = prevST > 50 && prevST + el.clientHeight >= prevSH - 50;
        if (nearBottom) {
          el.scrollTop = newSH;
        } else if (isVirtual) {
          el.scrollTop = prevST + diff;
        }
      } else if (n._startAtBottom) {
        el.scrollTop = newSH;
      }
    }

    n._lastST = el.scrollTop;
    n._lastSH = el.scrollHeight;

    if (!n._anchored) {
      n._anchored = true;
      onReadyContent?.(el);
    }

    update();
  }

  useEffect(() => {
    const el = s.current.content;
    if (el && s.current.ready) anchor(el);
  });

  function onContentRef(el: HTMLDivElement | null) {
    s.current.content = el;
    if (el && s.current.thumb) {
      if (!s.current.ready) init();
    }
  }

  function onThumbRef(el: HTMLDivElement | null) {
    s.current.thumb = el;
    if (el && s.current.content && !s.current.ready) init();
  }

  let virtualContent: any = null;
  if (isVirtual && virtualItems) {
    const len = virtualItems.length;
    if (len !== s.current._prevLen) {
      const oldLen = s.current._prevLen;
      const oldHeights = s.current.heights;
      if (len > oldLen && oldLen > 0) {
        const added = len - oldLen;
        const shifted = new Array(len);
        for (let i = 0; i < added; i++) shifted[i] = 0;
        for (let i = 0; i < oldLen; i++) shifted[i + added] = oldHeights[i] || 0;
        s.current.heights = shifted;
      } else {
        s.current.heights = new Array(len).fill(0);
      }
      s.current._prevLen = len;
    }
    const el = s.current.content;
    const ch = el?.clientHeight || 400;
    const vh = totalHeight();

    if (ch > 0 && vh > 0) {
      const st = Math.max(0, Math.min(scrollTop, vh - ch));
      const itemEst = s.current._estH;
      const buffer = Math.max(3, Math.ceil(ch / itemEst));
      const visibleTop = Math.max(0, st - buffer * itemEst);

      let acc = 0;
      let start = 0;
      for (let i = 0; i < len; i++) {
        const hi = getHeight(i);
        if (acc + hi > visibleTop) {
          start = Math.max(0, i - buffer);
          break;
        }
        acc += hi;
      }

      let end = start;
      acc = 0;
      for (let i = 0; i < start; i++) acc += getHeight(i);
      while (end < len && acc < st + ch + buffer * itemEst) {
        acc += getHeight(end);
        end++;
      }
      end = Math.min(len, end + buffer);

      let topH = 0;
      for (let i = 0; i < start; i++) topH += getHeight(i);
      let bottomH = 0;
      for (let i = end; i < len; i++) bottomH += getHeight(i);

      virtualContent = [
        <div key="vtop" style={`height:${topH}px;pointer-events:none`} />,
        ...virtualItems.slice(start, end).map((item, i) => {
          const idx = start + i;
          const ref = (el2: HTMLDivElement | null) => {
            if (el2 && el2.offsetHeight > 0 && s.current.heights[idx] !== el2.offsetHeight) {
              s.current.heights[idx] = el2.offsetHeight;
            }
          };
          return <div key={`vi-${idx}`} ref={ref}>{renderVirtualItem(item, idx)}</div>;
        }),
        <div key="vbottom" style={`height:${bottomH}px;pointer-events:none`} />,
      ];
    } else {
      virtualContent = <div key="vempty" />;
    }
  }

  return (
    <div id={id} class={'CustomScrollbar' + (className ? ' ' + className : '')} style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0, ...(style || {}) }}>
      <div ref={onContentRef} id={id ? id + '-content' : undefined} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', minHeight: 0, ...(maxHeight ? { maxHeight } : {}) }} onScroll={handleScroll}>
        {isVirtual ? virtualContent : children}
      </div>
      <div ref={onThumbRef} class="CustomScrollbar-thumb" style={{ display: 'none' }} />
    </div>
  );
}
