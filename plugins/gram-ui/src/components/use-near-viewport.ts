import { useEffect, useState } from '@ton-ai/atom/hooks';
import { observeVisibility } from './emoji-canvas.js';

export function useNearViewport(
  el: () => HTMLElement | null,
  attachTick: number,
  opts: { startMargin?: number; playMargin?: number } = {},
): { visible: boolean; playing: boolean } {
  const { startMargin = 200, playMargin = 80 } = opts;
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const node = el();
    if (!node || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(node, playMargin, (v) => setPlaying(v));
  }, [el, attachTick, playMargin]);

  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return;
    const node = el();
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: startMargin + 'px' });
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, [visible, el, attachTick, startMargin]);

  return { visible, playing };
}
