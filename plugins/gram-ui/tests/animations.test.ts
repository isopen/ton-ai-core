/**
 * @jest-environment jsdom
 */
import { defaultState, reducer } from '../src/state';
import { isReducedMotion } from '../src/components/theme-morph-icon';

describe('animationsEnabled setting', () => {
  test('defaults to enabled', () => {
    expect(defaultState().animationsEnabled).toBe(true);
  });
  test('reducer toggles the setting both ways', () => {
    const s0 = defaultState();
    const off = reducer(s0, { type: 'SET_ANIMATIONS_ENABLED', v: false });
    expect(off.animationsEnabled).toBe(false);
    expect(s0.animationsEnabled).toBe(true);
    expect(reducer(off, { type: 'SET_ANIMATIONS_ENABLED', v: true }).animationsEnabled).toBe(true);
  });
  test('unknown actions keep the setting', () => {
    const s0 = { ...defaultState(), animationsEnabled: false };
    expect(reducer(s0, { type: 'TICK' }).animationsEnabled).toBe(false);
  });
});

describe('isReducedMotion honors the app setting', () => {
  const prevMatchMedia = (window as any).matchMedia;
  const prevDataset = (document.documentElement as any).dataset.animations;
  afterEach(() => {
    (window as any).matchMedia = prevMatchMedia;
    if (prevDataset === undefined) delete (document.documentElement as any).dataset.animations;
    else (document.documentElement as any).dataset.animations = prevDataset;
  });
  test('dataset off forces reduced motion', () => {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    (document.documentElement as any).dataset.animations = 'off';
    expect(isReducedMotion()).toBe(true);
  });
  test('dataset on defers to the media query', () => {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    (document.documentElement as any).dataset.animations = 'on';
    expect(isReducedMotion()).toBe(false);
  });
  test('media query still works without the dataset flag', () => {
    (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    delete (document.documentElement as any).dataset.animations;
    expect(isReducedMotion()).toBe(true);
  });
});
