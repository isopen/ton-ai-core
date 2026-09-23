/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { DiffViewer } from '../dist/components/diff-viewer.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Comp: any = () => node;
  render(Comp, container);
  return container;
}

const hunks = [
  {
    head: '@@ -590,3 +590,4 @@',
    lines: [
      { nOld: 590, nNew: 590, text: 'same', kind: 'ctx' },
      { nOld: 591, text: 'old', kind: 'del' },
      { nNew: 591, text: 'new', kind: 'add' },
    ],
  },
];

describe('DiffViewer separate screen', () => {
  test('renders header and both panes', () => {
    const c = mount(h(DiffViewer as any, { filePath: 'a.ts', hunks, onClose: () => {} }));
    expect(c.querySelector('.DiffViewer__title')?.textContent).toBe('a.ts');
    expect(c.querySelector('.DiffViewer__pane_left')).toBeTruthy();
    expect(c.querySelector('.DiffViewer__pane_right')).toBeTruthy();
    c.remove();
  });
  test('back and toggles exist', () => {
    const c = mount(h(DiffViewer as any, { filePath: 'a.ts', hunks, onClose: () => {} }));
    expect(c.querySelector('.DiffViewer__back')).toBeTruthy();
    expect(c.querySelectorAll('.DiffViewer__toggle').length).toBe(2);
    c.remove();
  });
});
