import { h } from '@ton-ai/atom/jsx-runtime';
import { useRef, useState } from '@ton-ai/atom/hooks';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:slideshow');

function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function Slideshow({ count, renderItem, className = '', nav = 'bar', slideWidth }: {
  count: number;
  renderItem: (index: number) => any;
  className?: string;
  nav?: 'bar' | 'edges';
  slideWidth?: number;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef(false);
  const [index, setIndex] = useState(0);
  if (count <= 0) return null;
  const last = count - 1;
  const safeIndex = Math.max(0, Math.min(index, last));
  const edges = nav === 'edges';

  const readIndex = () => {
    const strip = stripRef.current;
    if (!strip) return;
    try {
      const base = strip.scrollLeft;
      const kids = Array.from(strip.children) as HTMLElement[];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < kids.length; i++) {
        const d = Math.abs(kids[i].offsetLeft - base);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best !== index) setIndex(best);
    } catch (e) {
      log.debug('[Slideshow] read index failed', e);
    }
  };

  const handleScroll = () => {
    if (tickRef.current) return;
    tickRef.current = true;
    requestAnimationFrame(() => {
      tickRef.current = false;
      readIndex();
    });
  };

  const goTo = (next: number) => {
    const strip = stripRef.current;
    const target = Math.max(0, Math.min(next, last));
    setIndex(target);
    if (!strip) return;
    try {
      const kids = strip.children;
      const el = kids[target] as HTMLElement | undefined;
      if (!el) return;
      strip.scrollTo({ left: el.offsetLeft, behavior: reducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      log.debug('[Slideshow] scroll failed', e);
    }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && safeIndex > 0) { e.preventDefault(); goTo(safeIndex - 1); }
    if (e.key === 'ArrowRight' && safeIndex < last) { e.preventDefault(); goTo(safeIndex + 1); }
  };

  const chevron = (prev: boolean) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{prev ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}</svg>
  );

  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={'rsl' + i} class="rich-slideshow-item">
        {renderItem(i)}
      </div>
    );
  }

  const dots = (
    <div class="rich-slideshow-dots">
      {items.map((_, i) => (
        <button
          key={'rsd' + i}
          type="button"
          class={'rich-slideshow-dot' + (i === safeIndex ? ' rich-slideshow-dot_active' : '')}
          aria-label={'Slide ' + (i + 1)}
          onClick={() => goTo(i)}
        />
      ))}
    </div>
  );

  const barBtn = (prev: boolean) => {
    const can = prev ? safeIndex > 0 : safeIndex < last;
    return (
      <button
        type="button"
        class={'rich-slideshow-btn' + (can ? '' : ' rich-slideshow-btn_disabled')}
        aria-label={prev ? 'Previous' : 'Next'}
        onClick={() => goTo(safeIndex + (prev ? -1 : 1))}
        disabled={!can}
      >
        {chevron(prev)}
      </button>
    );
  };

  const edgeBtn = (prev: boolean) => {
    const can = prev ? safeIndex > 0 : safeIndex < last;
    return (
      <button
        type="button"
        class={'rich-slideshow-edge rich-slideshow-edge_' + (prev ? 'prev' : 'next') + (can ? '' : ' rich-slideshow-edge_disabled')}
        aria-label={prev ? 'Previous' : 'Next'}
        onClick={(e: any) => { try { e.stopPropagation(); } catch {} goTo(safeIndex + (prev ? -1 : 1)); }}
        disabled={!can}
      >
        {chevron(prev)}
      </button>
    );
  };

  return (
    <div
      class={'rich-slideshow' + (edges ? ' rich-slideshow_edges' : '') + (className ? ' ' + className : '')}
      onKeyDown={count > 1 ? handleKey : undefined}
      tabIndex={count > 1 ? 0 : undefined}
      role={count > 1 ? 'group' : undefined}
      aria-label={count > 1 ? 'Slides' : undefined}
    >
      {edges && count > 1 ? (
        <div
          class="rich-slideshow-frame"
          style={slideWidth != null ? 'max-width:' + Math.max(slideWidth, 1) + 'px' : undefined}
        >
          <div
            class="rich-slideshow-strip"
            ref={(el: HTMLDivElement | null) => { stripRef.current = el; }}
            onScroll={handleScroll}
          >
            {items}
          </div>
          {edgeBtn(true)}
          {edgeBtn(false)}
        </div>
      ) : (
        <div
          class="rich-slideshow-strip"
          ref={(el: HTMLDivElement | null) => { stripRef.current = el; }}
          onScroll={handleScroll}
          style={slideWidth != null ? 'max-width:' + Math.max(slideWidth, 1) + 'px' : undefined}
        >
          {items}
        </div>
      )}
      {count > 1 && edges ? (
        <div class="rich-slideshow-dots_row">
          {dots}
        </div>
      ) : null}
      {count > 1 && !edges ? (
        <div class="rich-slideshow-controls">
          {barBtn(true)}
          {dots}
          {barBtn(false)}
        </div>
      ) : null}
    </div>
  );
}
