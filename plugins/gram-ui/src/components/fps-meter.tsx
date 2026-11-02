import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { isEnabled, subscribeScope } from '@ton-ai/gram-debug';
import { getBurstStats } from './emoji-burst.js';
import { getTgsStats } from './tgs-player.js';
import { getStickerFxStats } from './sticker-click-fx.js';
import { getEmojiVideoStats } from './emoji-text.js';
import { tickVisibilityStats } from '../utils/animated-renderer/tick-coordinator.js';
import { getStickerFxOverlayStats } from './animated-sticker.js';

const SCOPE = 'fps';

function hasHudUrlFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const q = window.location.search || '';
    if (/[?&]fps[=&]/.test(q) || /[?&]fps$/.test(q)) return true;
    const h = window.location.hash || '';
    return /(^|[#&])fps/.test(h);
  } catch {
    return false;
  }
}

let setVisibleGlobal: ((on: boolean) => void) | null = null;

(window as unknown as Record<string, unknown>).__tgFpsOverlay = (on: unknown) => {
  setVisibleGlobal?.(on !== false);
};

export function FpsMeter() {
  const [visible, setVisible] = useState(() => isEnabled(SCOPE) || hasHudUrlFlag());
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const winStartRef = useRef(0);
  const frameCountRef = useRef(0);
  const maxGapRef = useRef(0);
  const longRef = useRef(0);
  const lastStatsRef = useRef({ fps: 0, gap: 0, long: 0, extra: '' });

  useEffect(() => {
    setVisibleGlobal = setVisible;
    return () => {
      setVisibleGlobal = null;
    };
  }, []);

  useEffect(() => subscribeScope(SCOPE, () => setVisible(isEnabled(SCOPE))), []);

  useEffect(() => {
    if (!visible) return;
    const box = () => boxRef.current;
    const el0 = box();
    if (el0 && el0.childNodes.length === 0) {
      el0.textContent = 'FPS — · gap —ms · long 0';
    }
    const onFrame = (ts: number) => {
      rafRef.current = requestAnimationFrame(onFrame);
      if (!lastTsRef.current) {
        lastTsRef.current = ts;
        return;
      }
      const gap = ts - lastTsRef.current;
      lastTsRef.current = ts;
      frameCountRef.current++;
      if (gap > maxGapRef.current) maxGapRef.current = gap;
      if (ts - winStartRef.current >= 500) {
        const fps = (frameCountRef.current * 1000) / (ts - winStartRef.current);
        let extra = '';
        try {
          const bs = getBurstStats();
          const tgs = getTgsStats();
          const fx = getStickerFxStats();
          const ov = getStickerFxOverlayStats();
          const vis = tickVisibilityStats();
          const vid = getEmojiVideoStats();
          extra = ` · P ${bs.particles}/${bs.video} · B ${bs.spawns} · FX ${fx.particles}/${fx.spawns}/${fx.nodes} · OV ${ov.overlays} · TGS ${tgs.tasks}·D${tgs.drops}·G${tgs.gap} · V ${vis.hidden}/${vis.total} · Vid ${vid.active}/${vid.pending}`;
        } catch {
          extra = lastStatsRef.current.extra;
        }
        const s = { fps, gap: Math.round(maxGapRef.current), long: longRef.current, extra };
        const prev = lastStatsRef.current;
        if (s.fps !== prev.fps || s.gap !== prev.gap || s.long !== prev.long || s.extra !== prev.extra) {
          lastStatsRef.current = s;
          const el = box();
          if (el) {
            el.textContent = `FPS ${s.fps > 0 ? s.fps.toFixed(0) : '—'} · gap ${s.gap}ms · long ${s.long}${s.extra}`;
            el.style.background = s.fps > 0 && s.fps < 30 ? 'rgba(200,40,40,0.75)' : 'rgba(0,0,0,0.55)';
          }
        }
        frameCountRef.current = 0;
        maxGapRef.current = 0;
        winStartRef.current = ts;
      }
    };
    let obs: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        obs = new PerformanceObserver((list) => {
          longRef.current += list.getEntries().length;
        });
        obs.observe({ entryTypes: ['longtask'] });
      } catch {}
    }
    winStartRef.current = performance.now();
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(onFrame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      obs?.disconnect();
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      ref={boxRef}
      id="tg-fps-meter"
      style={`position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:3px 10px;border-radius:8px;font:11px/1.4 monospace;color:#fff;background:rgba(0,0,0,0.55);pointer-events:none;user-select:none;white-space:nowrap;backdrop-filter:blur(2px)`}
    ></div>
  );
}
