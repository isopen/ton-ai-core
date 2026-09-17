import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useRef, useEffect } from '@ton-ai/atom/hooks';

interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  disabled?: boolean;
  name?: string;
  ariaLabel?: string;
  className?: string;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
}

function toFinite(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function snapSliderValue(raw: number, min: number, max: number, step: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(raw)) return lo;
  const clamped = Math.min(hi, Math.max(lo, raw));
  if (!(step > 0)) return clamped;
  const snapped = lo + Math.round((clamped - lo) / step) * step;
  const decimals = Math.min(6, ((String(step).split('.')[1] || '').length));
  return Number(Math.min(hi, Math.max(lo, snapped)).toFixed(decimals));
}

export function sliderFillPercent(current: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!(hi > lo)) return 0;
  return (Math.min(hi, Math.max(lo, current)) - lo) / (hi - lo) * 100;
}

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  disabled = false,
  name,
  ariaLabel,
  className = '',
  onChange,
  onCommit,
}: SliderProps) {
  const lo = toFinite(min, 0);
  const hi = toFinite(max, 100);
  const loBound = Math.min(lo, hi);
  const hiBound = Math.max(lo, hi);
  const stepSize = toFinite(step, 1);
  const [inner, setInner] = useState(
    defaultValue !== undefined ? snapSliderValue(defaultValue, loBound, hiBound, stepSize) : loBound,
  );
  const controlled = value !== undefined;
  const current = snapSliderValue(controlled ? (value as number) : inner, loBound, hiBound, stepSize);
  const fill = sliderFillPercent(current, loBound, hiBound);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef(false);
  useEffect(() => {
    const el = inputRef.current;
    if (!el || dragRef.current || el.value === String(current)) return;
    el.value = String(current);
  });

  let cls = 'Slider';
  if (disabled) cls += ' Slider_disabled';
  if (className) cls += ' ' + className;

  return (
    <span class={cls} style={'--slider-fill:' + fill + '%'}>
      <input
        ref={(el: HTMLInputElement | null) => { inputRef.current = el; }}
        type="range"
        class="Slider__input"
        min={String(loBound)}
        max={String(hiBound)}
        step={stepSize > 0 ? String(stepSize) : 'any'}
        name={name}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerdown={() => { dragRef.current = true; }}
        onPointerup={() => { dragRef.current = false; }}
        onPointercancel={() => { dragRef.current = false; }}
        onInput={(e: any) => {
          const next = snapSliderValue(Number((e.target as HTMLInputElement).value), loBound, hiBound, stepSize);
          if (!controlled) setInner(next);
          onChange?.(next);
        }}
        onChange={(e: any) => {
          const next = snapSliderValue(Number((e.target as HTMLInputElement).value), loBound, hiBound, stepSize);
          if (!controlled) setInner(next);
          dragRef.current = false;
          onCommit?.(next);
        }}
      />
    </span>
  );
}
