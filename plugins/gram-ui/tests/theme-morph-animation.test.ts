/**
 * @jest-environment jsdom
 */
import { h } from '@ton-ai/atom/jsx-runtime';
import { render } from '@ton-ai/atom/render';
import { useState } from '@ton-ai/atom/hooks';
import { ThemeToggle } from '../src/components/theme-morph-icon';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('click yields intermediate morph frames in real time', async () => {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  (global as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
  (global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

  function Wrap() {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    return h(ThemeToggle, { theme, onToggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
  }

  const box = document.createElement('div');
  document.body.appendChild(box);
  render(Wrap, box);
  const btn = box.querySelector('button') as HTMLButtonElement;
  const path = () => box.querySelector('path')!.getAttribute('d')!;
  const d0 = path();

  console.log('d0:', d0.slice(0, 50));

  btn.click();
  const samples: string[] = [];
  for (let i = 0; i < 8; i++) {
    await sleep(100);
    samples.push(path());
  }
  samples.forEach((s, i) => {
    console.log(`t~${(i + 1) * 100}ms:`, s.slice(0, 50), s === d0 ? '== d0' : '');
  });
  const dFinal = samples[samples.length - 1];

  console.log('final == d0?', dFinal === d0, 'unique frames:', new Set(samples).size);

  const mid = samples.slice(1, 5);
  const hasIntermediate = mid.some((s) => s !== d0 && s !== dFinal);
  expect(hasIntermediate).toBe(true);
  (box as any).__atomRoot?.unmount();
  box.remove();
}, 15000);
