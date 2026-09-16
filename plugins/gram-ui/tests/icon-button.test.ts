/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { IconButton } from '../dist/primitives/icon-button.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountIconButton(props: any): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(IconButton as any, { label: 'Close', onClick: () => {}, children: 'X', ...props });
  render(Probe, container);
  return container;
}

describe('icon button primitive', () => {
  test('renders labelled button with content', () => {
    const c = mountIconButton({});
    const btn = c.querySelector('button.IconButton') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Close');
    expect(btn.getAttribute('title')).toBe('Close');
    expect(btn.textContent).toBe('X');
    document.body.removeChild(c);
  });

  test('click reaches the handler', () => {
    const seen: string[] = [];
    const c = mountIconButton({ onClick: () => seen.push('x') });
    (c.querySelector('button.IconButton') as HTMLElement).click();
    expect(seen).toEqual(['x']);
    document.body.removeChild(c);
  });

  test('custom className extends the button', () => {
    const c = mountIconButton({ className: 'mock-close' });
    expect(c.querySelector('button.IconButton.mock-close')).not.toBeNull();
    document.body.removeChild(c);
  });
});
