import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { S, t, tpl } from '@ton-ai/gram-lang';
import { Badge } from '../primitives/badge.js';

function isAtBottomEl(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}

export function countNewBelow(rows: readonly { msgs?: readonly { id?: number }[] }[], lastVisibleId: number): number {
  let total = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const msgs = rows[i]?.msgs;
    if (!msgs || msgs.length === 0) continue;
    let below = 0;
    for (const m of msgs) if ((m.id ?? 0) > lastVisibleId) below++;
    if (below === 0) break;
    if (below < msgs.length) return below;
    total += below;
  }
  return total;
}

export function lastVisibleMessageId(list: HTMLElement | null): number {
  if (!list) return 0;
  const bottom = list.getBoundingClientRect().bottom;
  let id = 0;
  for (const row of Array.from(list.querySelectorAll<HTMLElement>('.tgui-msg-row[id^="msg-"]'))) {
    if (row.getBoundingClientRect().top >= bottom) continue;
    const rowId = Number(row.id.slice(4));
    if (rowId > id) id = rowId;
  }
  return id;
}

export function countNewBelowViewport(list: HTMLElement | null, rows: readonly { msgs?: readonly { id?: number }[] }[]): number {
  if (!list || isAtBottomEl(list) || rows.length === 0) return 0;
  return countNewBelow(rows, lastVisibleMessageId(list));
}

export function listElement(): HTMLElement | null {
  return document.getElementById('tg-msg-list-content');
}

export function holdBottom(el: HTMLElement, durationMs = 800): void {
  const startedAt = Date.now();
  let lastTop = el.scrollTop;
  const pin = () => {
    if (!el.isConnected || Date.now() - startedAt > durationMs) return;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (el.scrollTop < lastTop) return;
    lastTop = el.scrollTop;
    if (el.scrollTop < maxTop - 2) {
      lastTop = maxTop;
      el.scrollTop = maxTop;
    }
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
}

export function useShowGotoBottom(listId: string, active: boolean, onViewportTick?: () => void): boolean {
  const [show, setShow] = useState(false);
  const timerRef = useRef(0);
  const tickRef = useRef(0);
  const tickRefFn = useRef(onViewportTick);
  tickRefFn.current = onViewportTick;
  useEffect(() => {
    if (!active) return;
    setShow(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
    const el = listElement();
    if (!el) return;
    const scheduleTick = () => {
      if (tickRef.current) return;
      tickRef.current = requestAnimationFrame(() => {
        tickRef.current = 0;
        tickRefFn.current?.();
      });
    };
    const onScroll = () => {
      scheduleTick();
      if (isAtBottomEl(el)) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = 0;
        }
        setShow((v) => (v ? false : v));
        return;
      }
      if (!timerRef.current) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = 0;
          if (!el.isConnected) return;
          if (!isAtBottomEl(el)) setShow(true);
        }, 200);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    if (!isAtBottomEl(el)) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        if (el.isConnected && !isAtBottomEl(el)) setShow(true);
      }, 200);
    }
    scheduleTick();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (tickRef.current) {
        cancelAnimationFrame(tickRef.current);
        tickRef.current = 0;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    };
  }, [listId, active]);
  return show;
}

export function scrollListToBottom(): void {
  const el = listElement();
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  holdBottom(el);
}

export function GotoBottomButton({ visible, newCount, onGo }: { visible: boolean; newCount: number; onGo: () => void }) {
  if (!visible) return null;
  const label = newCount > 0 ? tpl(S.CHAT_NEW_MESSAGES, { count: newCount }) : '';
  return (
    <div class="tgui-goto-bottom-wrap">
      {newCount > 0 ? (
        <span class="tgui-goto-bottom-count" aria-hidden="true">
          <Badge count={newCount} variant="pill" />
        </span>
      ) : null}
      <button
        type="button"
        class="tgui-goto-bottom"
        aria-label={label ? `${t(S.CHAT_SCROLL_TO_BOTTOM)}, ${label}` : t(S.CHAT_SCROLL_TO_BOTTOM)}
        onClick={onGo}
      >
        <svg class="tgui-goto-bottom-arrow" viewBox="0 0 18 11" width="18" height="11" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1.4 1.2 9 8.9 16.6 1.2" />
        </svg>
      </button>
    </div>
  );
}
