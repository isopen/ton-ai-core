import { TGUI_CSS } from './tgui-css.js';

export function injectStyles(): HTMLStyleElement {
  const id = 'tg-ui-styles';
  const existing = document.getElementById(id);
  if (existing) {
    existing.textContent = TGUI_CSS;
    return existing as HTMLStyleElement;
  }

  const el = document.createElement('style');
  el.id = id;
  el.textContent = TGUI_CSS;
  document.head.appendChild(el);
  return el;
}
