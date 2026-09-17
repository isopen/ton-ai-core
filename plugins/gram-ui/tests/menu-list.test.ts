/**
 * @jest-environment jsdom
 */
import { strict as assert } from 'assert';
import { render } from '@ton-ai/atom';
import { MenuList } from '../dist/primitives/menu-list.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(props: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Comp: any = () => h(MenuList as any, props);
  render(Comp, container);
  return container;
}

const ITEMS = [
  { id: 'chat', label: 'Chat Settings' },
  { id: 'devices', label: 'Devices' },
];

describe('MenuList primitive', () => {
  test('renders items with labels and width', () => {
    const c = mount({ items: ITEMS, width: 300 });
    const labels = Array.from(c.querySelectorAll('.tgui-menu-label')).map((el) => el.textContent);
    assert.deepStrictEqual(labels, ['Chat Settings', 'Devices']);
    const card = c.querySelector('.tgui-settings-card') as HTMLElement;
    assert.ok(card.getAttribute('style')?.includes('width:300px'));
  });

  test('item click calls onSelect with id', () => {
    const seen: string[] = [];
    const c = mount({ items: ITEMS.map((i) => ({ ...i, onSelect: (id: string) => { seen.push(id); } })) });
    const btns = Array.from(c.querySelectorAll('.tgui-menu-item')) as HTMLElement[];
    assert.equal(btns.length, 2);
    btns[1].click();
    assert.deepStrictEqual(seen, ['devices']);
  });

  test('collapsible list toggles items', async () => {
    const c = mount({ items: ITEMS, title: 'More', collapsible: true });
    assert.equal(c.querySelectorAll('.tgui-menu-item').length, 1);
    const header = c.querySelector('.tgui-menu-item') as HTMLElement;
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    header.click();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(c.querySelectorAll('.tgui-menu-item').length, 3);
    assert.equal(c.querySelector('.tgui-menu-item')?.getAttribute('aria-expanded'), 'true');
    assert.ok(c.querySelector('.tgui-menu-chevron_open'));
    document.body.removeChild(c);
  });

  test('bare mode keeps rows without card chrome', async () => {
    const c = mount({ title: 'Backgrounds', collapsible: true, defaultExpanded: true, bare: true, children: h('div', { class: 'tgui-wall-grid' }) });
    const card = c.querySelector('.tgui-menu-list') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.classList.contains('tgui-menu-list_bare')).toBe(true);
    expect(card.classList.contains('tgui-settings-card')).toBe(false);
    expect(c.querySelector('.tgui-wall-grid')).not.toBeNull();
    (c.querySelector('.tgui-menu-item') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(c.querySelector('.tgui-wall-grid')).toBeNull();
    document.body.removeChild(c);
  });

  test('collapsible list toggles children block', async () => {
    const c = mount({ title: 'Backgrounds', collapsible: true, defaultExpanded: true, children: h('div', { class: 'tgui-wall-grid' }) });
    expect(c.querySelector('.tgui-wall-grid')).not.toBeNull();
    const header = c.querySelector('.tgui-menu-item') as HTMLElement;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(c.querySelector('.tgui-wall-grid')).toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(c.querySelector('.tgui-wall-grid')).not.toBeNull();
    expect(c.querySelector('.tgui-menu-content')).not.toBeNull();
    document.body.removeChild(c);
  });
});
