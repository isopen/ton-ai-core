/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { ChatArea } from '../dist/components/chat-area.js';
import { Scrollable } from '../dist/primitives/scrollable.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(state: any, skills: any[]): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('style', 'display:flex;flex-direction:column;height:600px');
  document.body.appendChild(container);
  const Comp: any = () => h(ChatArea as any, { state, dispatch: () => {}, skills });
  render(Comp, container);
  return container;
}

function testState(): any {
  return {
    selectedPeer: null,
    activeSkill: '_test_',
    messages: [],
    dialogs: [],
    documentUrls: {},
    peerWallpapers: {},
    defaultWallpaper: null,
  };
}

function testSkills(): any[] {
  return [{
    id: '_test_',
    label: 'Test',
    render: () => h(Scrollable as any, { className: 'tgui-test-skill' },
      h('div', { style: 'height:2000px' }, 'tall')),
  }];
}

describe('skill panel scrolls like dialogs', () => {
  test('panel is a flex column with hidden native overflow', async () => {
    const c = mount(testState(), testSkills());
    await new Promise((r) => setTimeout(r, 50));
    const panel = c.querySelector('.tgui-plugin-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    const style = panel.getAttribute('style') || '';
    expect(style).toContain('flex-direction:column');
    expect(style).toContain('overflow:hidden');
    expect(style).not.toContain('overflow-y:auto');
    document.body.removeChild(c);
  });

  test('header stays fixed outside the telegram scroller', async () => {
    const c = mount(testState(), testSkills());
    await new Promise((r) => setTimeout(r, 50));
    const panel = c.querySelector('.tgui-plugin-panel') as HTMLElement;
    const header = panel.querySelector('.tgui-plugin-panel-header') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.parentElement).toBe(panel);
    expect(panel.querySelector('.CustomScrollbar')).not.toBeNull();
    document.body.removeChild(c);
  });
});
