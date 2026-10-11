/**
 * @jest-environment jsdom
 */

import fs from 'node:fs';
import path from 'node:path';

const built = path.resolve(__dirname, '../dist/styles.css');
const source = path.resolve(__dirname, '../src/styles.css');
const cssPath = fs.existsSync(built) ? built : source;

function computedFor(className: string): Record<string, string> {
  const css = fs.readFileSync(cssPath, 'utf8');
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  document.body.innerHTML = '';
  const body = document.createElement('div');
  body.className = 'tgui-chat-body';
  const wall = document.createElement('div');
  wall.className = 'tgui-chat-wallpattern';
  const list = document.createElement('div');
  list.className = 'tgui-msg-list';
  list.id = 'tg-msg-list-content';
  const wrap = document.createElement('div');
  wrap.className = 'tgui-goto-bottom-wrap';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = '<svg class="tgui-goto-bottom-arrow" viewBox="0 0 18 11"></svg>';
  if (className === 'tgui-goto-bottom') wrap.appendChild(button);
  else body.appendChild(button);
  body.appendChild(wall);
  body.appendChild(list);
  body.appendChild(wrap);
  document.body.appendChild(body);
  const target = className === 'tgui-goto-bottom-wrap' ? wrap : button;
  const cs = getComputedStyle(target);
  const out: Record<string, string> = {};
  for (const prop of ['position', 'right', 'bottom', 'left', 'top', 'width', 'height', 'z-index', 'flex-direction', 'align-items', 'border-radius']) {
    out[prop] = cs.getPropertyValue(prop);
  }
  document.head.removeChild(styleEl);
  document.body.innerHTML = '';
  return out;
}

describe('goto bottom button placement', () => {
  test('wrapper is absolutely positioned at the bottom right of the chat body', () => {
    const cs = computedFor('tgui-goto-bottom-wrap');
    expect(cs.position).toBe('absolute');
    expect(cs.right).toBe('16px');
    expect(cs.bottom).toBe('16px');
    expect(cs.left).toBe('auto');
    expect(cs.top).toBe('auto');
    expect(cs['z-index']).toBe('2');
  });

  test('count bubble stacks above the round button', () => {
    const cs = computedFor('tgui-goto-bottom-wrap');
    expect(cs['flex-direction']).toBe('column');
    expect(cs['align-items']).toBe('flex-end');
  });

  test('button is a round circle inside the wrapper', () => {
    const cs = computedFor('tgui-goto-bottom');
    expect(cs.position).toBe('relative');
    expect(cs.width).toBe('40px');
    expect(cs.height).toBe('40px');
    expect(cs['border-radius']).toBe('50%');
  });

  test('button uses the telegram blue gradient with a soft glow', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const rule = css.match(/\.tgui-goto-bottom \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('linear-gradient(160deg, #3d9ef9 0%, #2785f3 100%)');
    expect(rule![0]).toContain('box-shadow: 0 5px 12px rgba(40, 130, 230, 0.45)');
    expect(rule![0]).toContain('color: #fff');
  });

  test('chevron geometry matches the mock proportions', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const rule = css.match(/\.tgui-goto-bottom-arrow \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('width: 18px');
    expect(rule![0]).toContain('height: 11px');
  });

  test('count bubble carries the accent tail and no inline margin', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.tgui-goto-bottom-count::after \{[^}]*transform: rotate\(45deg\)/);
    expect(css).toMatch(/\.tgui-goto-bottom-count \.Badge \{[^}]*margin-left: 0/);
  });

  test('the generic chat body child rule does not capture the wrapper', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const rule = css.match(/\.tgui-chat-body > \*[^{]*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain(':not(.tgui-goto-bottom-wrap)');
  });

  test('the message list keeps its stacking context', () => {
    const cs = computedFor('tgui-msg-list');
    expect(cs.position).toBe('relative');
    expect(cs['z-index']).toBe('1');
  });
});
