/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { Tabs } from '../dist/primitives/tabs.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

const ITEMS = [
  { id: 'emoji', label: 'Emoji' },
  { id: 'stickers', label: 'Stickers' },
  { id: 'gif', label: 'GIF' },
];

function mountTabs(props: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(Tabs as any, { label: 'Content type', items: ITEMS, active: 'emoji', onSelect: () => {}, ...props });
  render(Probe, container);
  return container;
}

describe('tabs primitive', () => {
  test('renders nav with one button per item', () => {
    const c = mountTabs({});
    const nav = c.querySelector('nav.TguiTabs');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('Content type');
    expect(nav?.querySelectorAll('.TguiTabs__tab').length).toBe(3);
    document.body.removeChild(c);
  });

  test('marks only the active tab', () => {
    const c = mountTabs({ active: 'stickers' });
    const tabs = Array.from(c.querySelectorAll('.TguiTabs__tab'));
    expect(tabs.map((el) => el.classList.contains('is-active'))).toEqual([false, true, false]);
    document.body.removeChild(c);
  });

  test('click selects the tab id', () => {
    const seen: string[] = [];
    const c = mountTabs({ onSelect: (id: string) => seen.push(id) });
    (Array.from(c.querySelectorAll('.TguiTabs__tab')).find((el) => el.textContent === 'GIF') as HTMLElement).click();
    expect(seen).toEqual(['gif']);
    document.body.removeChild(c);
  });

  test('renders icons when provided and skips empty aria labels', () => {
    const runtime = require('@ton-ai/atom/jsx-runtime') as any;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => runtime.h(Tabs as any, {
      label: 'Sections',
      active: 'a',
      onSelect: () => {},
      items: [{ id: 'a', label: 'A', icon: runtime.h('i', { class: 'mock-icon' }) }, { id: 'b', label: 'B' }],
    });
    render(Probe, container);
    expect(container.querySelectorAll('.TguiTabs__icon .mock-icon').length).toBe(1);
    expect(container.querySelector('.TguiTabs__tab')?.hasAttribute('aria-label')).toBe(false);
    document.body.removeChild(container);
  });

  test('custom className extends the nav', () => {
    const c = mountTabs({ className: 'mock-tabs' });
    expect(c.querySelector('nav.TguiTabs.mock-tabs')).not.toBeNull();
    document.body.removeChild(c);
  });
});
