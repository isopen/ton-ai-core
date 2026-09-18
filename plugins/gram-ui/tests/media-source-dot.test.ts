/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { MediaSourceBadge } from '../dist/components/media-source-badge.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mountDot(source: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Probe: any = () => h(MediaSourceBadge as any, { source, variant: 'dot' });
  render(Probe, container);
  return container;
}

describe('media source dot', () => {
  beforeAll(() => {
    setScope('gram-ui:media-source-badge', { enabled: true });
  });

  test.each([
    ['memory', 'tgui-media-source-badge--mem', 'in-memory'],
    ['persisted', 'tgui-media-source-badge--db', 'gram-db'],
    ['home-server', 'tgui-media-source-badge--srv', 'home-server'],
    ['cdn-server', 'tgui-media-source-badge--srv', 'cdn-server'],
  ])('source %s renders modifier %s with label %s', async (source, mod, label) => {
    const container = mountDot(source);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.className).toContain(mod);
      expect(dot.getAttribute('title')).toBe(label);
      expect(dot.getAttribute('style') || '').not.toContain('background');
    } finally {
      document.body.removeChild(container);
    }
  });

  test('dot styling lives in css', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
    for (const mod of ['mem', 'db', 'srv']) {
      expect(css).toContain(`.tgui-media-source-badge--${mod}`);
    }
    expect(css).toContain('background: var(--dot)');
    expect(css).toContain('@keyframes tgui-dot-pop');
  });

  test('badge never intercepts taps', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
    const baseBlock = /\.tgui-media-source-badge\s*\{[^}]*\}/.exec(css);
    expect(baseBlock).not.toBeNull();
    expect(baseBlock![0]).toContain('pointer-events: none');
  });
});
