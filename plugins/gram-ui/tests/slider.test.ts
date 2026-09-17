/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';
import { Slider, snapSliderValue, sliderFillPercent } from '../dist/primitives/slider.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(props: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Comp: any = () => h(Slider as any, props);
  render(Comp, container);
  return container;
}

function setRange(input: HTMLInputElement, v: string): void {
  input.value = v;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('Slider primitive', () => {
  test('renders native range with bounds and fill', async () => {
    const c = mount({ min: 12, max: 30, step: 1, defaultValue: 16, ariaLabel: 'Message text size' });
    await new Promise((r) => setTimeout(r, 30));
    const input = c.querySelector('input.Slider__input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('range');
    expect(input.min).toBe('12');
    expect(input.max).toBe('30');
    expect(input.step).toBe('1');
    expect(input.getAttribute('aria-label')).toBe('Message text size');
    expect(input.value).toBe('16');
    const wrap = c.querySelector('.Slider') as HTMLElement;
    expect(wrap.getAttribute('style') || '').toContain('--slider-fill:22.222');
    document.body.removeChild(c);
  });

  test('drag reports snapped live value and moves fill', async () => {
    const seen: number[] = [];
    const committed: number[] = [];
    const c = mount({ min: 12, max: 30, step: 1, defaultValue: 16, onChange: (v: number) => { seen.push(v); }, onCommit: (v: number) => { committed.push(v); } });
    await new Promise((r) => setTimeout(r, 30));
    const input = c.querySelector('input.Slider__input') as HTMLInputElement;
    setRange(input, '20.7');
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual([21]);
    expect(committed).toEqual([]);
    expect(input.value).toBe('21');
    expect((c.querySelector('.Slider') as HTMLElement).getAttribute('style') || '').toContain('--slider-fill:50%');
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(committed).toEqual([21]);
    expect(seen).toEqual([21]);
    document.body.removeChild(c);
  });

  test('controlled value restores on parent re-render', async () => {
    let setTick: any = null;
    const Probe: any = () => {
      const [tick, setT] = (useState as any)(0);
      setTick = setT;
      void tick;
      return h(Slider as any, { min: 12, max: 30, step: 1, value: 18, defaultValue: 12 });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(Probe as any, {});
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 30));
    const input = container.querySelector('input.Slider__input') as HTMLInputElement;
    expect(input.value).toBe('18');
    input.value = '24';
    setTick(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(input.value).toBe('18');
    document.body.removeChild(container);
  });

  test('active drag is not yanked by parent re-render', async () => {
    let setTick: any = null;
    const Probe: any = () => {
      const [tick, setT] = (useState as any)(0);
      setTick = setT;
      void tick;
      return h(Slider as any, { min: 12, max: 30, step: 0.01, value: 15.5 });
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => h(Probe as any, {});
    render(Comp, container);
    await new Promise((r) => setTimeout(r, 30));
    const input = container.querySelector('input.Slider__input') as HTMLInputElement;
    input.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    input.value = '15.8';
    setTick(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(input.value).toBe('15.8');
    input.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
    setTick(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(input.value).toBe('15.5');
    document.body.removeChild(container);
  });

  test('clamps out-of-range defaults', async () => {
    const c = mount({ min: 12, max: 30, defaultValue: 99 });
    await new Promise((r) => setTimeout(r, 30));
    expect((c.querySelector('input.Slider__input') as HTMLInputElement).value).toBe('30');
    document.body.removeChild(c);
    const c2 = mount({ min: 12, max: 30 });
    await new Promise((r) => setTimeout(r, 30));
    expect((c2.querySelector('input.Slider__input') as HTMLInputElement).value).toBe('12');
    document.body.removeChild(c2);
  });

  test('disabled renders non-interactive input', async () => {
    const c = mount({ min: 12, max: 30, defaultValue: 16, disabled: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(c.querySelector('.Slider_disabled')).not.toBeNull();
    expect((c.querySelector('input.Slider__input') as HTMLInputElement).disabled).toBe(true);
    document.body.removeChild(c);
  });

  test('snap helper rounds to step and swaps inverted bounds', () => {
    expect(snapSliderValue(16.6, 12, 30, 1)).toBe(17);
    expect(snapSliderValue(12.4, 12, 30, 1)).toBe(12);
    expect(snapSliderValue(16.3, 12, 30, 0.5)).toBe(16.5);
    expect(snapSliderValue(99, 12, 30, 1)).toBe(30);
    expect(snapSliderValue(1, 12, 30, 1)).toBe(12);
    expect(snapSliderValue(NaN, 12, 30, 1)).toBe(12);
    expect(snapSliderValue(20, 30, 12, 1)).toBe(20);
  });

  test('fill helper maps value to percent', () => {
    expect(sliderFillPercent(12, 12, 30)).toBe(0);
    expect(sliderFillPercent(30, 12, 30)).toBe(100);
    expect(sliderFillPercent(21, 12, 30)).toBe(50);
    expect(sliderFillPercent(5, 12, 12)).toBe(0);
  });
});

describe('Slider styles', () => {
  function builtCss(): string {
    return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
  }

  test('track uses accent fill driven by variable', () => {
    const css = builtCss();
    expect(css).toContain('.Slider__input::-webkit-slider-runnable-track');
    expect(css).toContain('--slider-fill');
    expect(css).toContain('.Slider__input::-moz-range-progress');
  });

  test('thumb is round accent with press and focus states', () => {
    const css = builtCss();
    expect(css).toContain('.Slider__input::-webkit-slider-thumb');
    expect(css).toContain('.Slider__input::-moz-range-thumb');
    expect(css).toContain('.Slider__input:active::-webkit-slider-thumb');
    expect(css).toContain('.Slider__input:focus-visible');
  });

  test('reduced motion disables thumb transition', () => {
    const css = builtCss();
    const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g)].map((m) => m[0]);
    expect(blocks.some((b) => b.includes('.Slider__input::-webkit-slider-thumb'))).toBe(true);
  });
});
