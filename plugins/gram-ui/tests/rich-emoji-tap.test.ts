/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { setScope } from '@ton-ai/gram-debug';
import { attachEmojiBurst, pickInteractionAnchor } from '../dist/components/emoji-burst.js';
import { CustomEmojiNode, setRichSources } from '../dist/components/rich-message.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function rect(el: Element, x: number, y: number, w: number, h: number) {
  (el as any).getBoundingClientRect = () => ({
    left: x, top: y, width: w, height: h, right: x + w, bottom: y + h,
    x, y, toJSON: () => {},
  });
}

function richBubble(): HTMLElement {
  const doc = document;
  const el = (tag: string, cls: string, parent: Element): HTMLElement => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    parent.appendChild(n);
    return n;
  };
  const bubble = doc.createElement('div');
  bubble.id = 'msg-190788';
  bubble.className = 'MessageBubble MessageBubble_in MessageBubble_rich';
  const text = el('div', 'MessageBubble__text', bubble);
  const body = el('div', 'rich-body', text);
  const block = el('div', 'rich-block', body);
  const p = el('p', 'rich-p', block);
  const anchor = el('span', '', p);
  anchor.setAttribute('data-doc', '6147654280112248427');
  anchor.setAttribute('style', 'display:contents');
  const scaled = el('span', 'tgui-emoji-scaled', anchor);
  scaled.setAttribute('style', 'width:calc(var(--message-font-size, 14px) * 1.3571);height:calc(var(--message-font-size, 14px) * 1.3571)');
  const player = el('div', 'TgsPlayer tgui-emoji-inline', scaled);
  player.setAttribute('style', 'width: 19px; height: 19px;');
  const canvas = el('canvas', '', player) as HTMLCanvasElement;
  canvas.width = 23;
  canvas.height = 23;
  p.appendChild(doc.createTextNode(' Take a quick quiz'));
  doc.body.appendChild(bubble);
  return bubble;
}

describe('rich message emoji tap', () => {
  beforeAll(() => {
    setScope('gram-ui:media-source-badge', { enabled: true });
  });
  test('tap on forwarded rich TGS dispatches interaction with docId', async () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = richBubble();
      const canvas = bubble.querySelector('canvas') as HTMLElement;
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      await new Promise((r) => setTimeout(r, 20));
      expect(seen.length).toBe(1);
      expect(seen[0].messageId).toBe('190788');
      expect(seen[0].mediaType).toBe('emoji');
      expect(seen[0].docId).toBe('6147654280112248427');
      expect(seen[0].slotIndex).toBeUndefined();
      document.body.removeChild(bubble);
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
    }
  });

  test('tap on emoji inside bot button does not dispatch (callback wins)', async () => {
    attachEmojiBurst();
    const seen: any[] = [];
    const onReq = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('tg-interaction-request', onReq);
    try {
      const bubble = document.createElement('div');
      bubble.id = 'msg-9';
      bubble.className = 'MessageBubble MessageBubble_in MessageBubble_rich';
      bubble.innerHTML =
        '<button class="rich-btn" type="button"><span>Participate ' +
        '<span data-doc="1" style="display:contents">' +
        '<span class="tgui-emoji-scaled"><div class="TgsPlayer tgui-emoji-inline"><canvas width="29" height="29"></canvas></div></span>' +
        '</span></span></button>';
      document.body.appendChild(bubble);
      const canvas = bubble.querySelector('canvas') as HTMLElement;
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
      await new Promise((r) => setTimeout(r, 20));
      expect(seen.length).toBe(0);
      document.body.removeChild(bubble);
    } finally {
      window.removeEventListener('tg-interaction-request', onReq);
    }
  });

  test('anchor prefers tapped rich node over distant slot', () => {
    const bubble = document.createElement('div');
    bubble.innerHTML =
      '<span class="tgui-emoji-slot" data-doc="1">X</span>' +
      '<span data-doc="2" style="display:contents"><span class="tgui-emoji-scaled"><div class="TgsPlayer">Y</div></span></span>';
    document.body.appendChild(bubble);
    const win = window as any;
    const origH = win.innerHeight;
    win.innerHeight = 800;
    try {
      const [slot, scaled] = [bubble.children[0], bubble.children[1].querySelector('.tgui-emoji-scaled')] as HTMLElement[];
      rect(slot, 500, 500, 20, 20);
      rect(scaled, 10, 10, 19, 19);
      expect(pickInteractionAnchor(bubble, 15, 15)).toBe(scaled);
    } finally {
      win.innerHeight = origH;
      document.body.removeChild(bubble);
    }
  });

  test('CustomEmojiNode output carries data-doc wrapper', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(CustomEmojiNode as any, { documentId: '6147654280112248427', alt: '🚀', documentUrls: {} });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    const wrap = container.querySelector('span[data-doc="6147654280112248427"]');
    expect(wrap).not.toBeNull();
    document.body.removeChild(container);
  });

  test('CustomEmojiNode with known source renders badge dot', async () => {
    setRichSources('m9', { 'emojipack-614': 'persisted' });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(CustomEmojiNode as any, {
      documentId: '614', alt: '🚀', documentUrls: { 'emojipack-614': 'blob:x' }, messageId: 'm9',
    });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const dot = container.querySelector('.tgui-media-source-badge--dot') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.className).toContain('tgui-media-source-badge--db');
    } finally {
      document.body.removeChild(container);
    }
  });

  test('CustomEmojiNode without source renders no dot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(CustomEmojiNode as any, {
      documentId: '615', alt: '🚀', documentUrls: { 'emojipack-615': 'blob:y' }, messageId: 'm-empty',
    });
    render(Probe, container);
    await new Promise((r) => setTimeout(r, 30));
    try {
      expect(container.querySelector('.tgui-media-source-badge--dot')).toBeNull();
    } finally {
      document.body.removeChild(container);
    }
  });
});
