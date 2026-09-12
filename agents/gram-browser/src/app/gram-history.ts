import type { Message } from '@ton-ai/gram-ui';

export const HISTORY_MAX_CACHED_MESSAGES = 300;
export const HISTORY_MAX_CACHED_PEERS = 50;

export function historyMessageId(m: Message): number {
  return Number(m?.id) || 0;
}

export function historySortKey(m: Message): number {
  const id = historyMessageId(m);
  return id < 0 ? Number.MAX_SAFE_INTEGER : id;
}

export function sortHistoryMessages(list: Message[]): Message[] {
  return [...list].sort((a, b) => historySortKey(a) - historySortKey(b) || (a.date || 0) - (b.date || 0));
}

export function mergeHistoryMessages(fresh: Message[], current: Message[]): Message[] {
  const seen = new Set<number>();
  const out: Message[] = [];
  for (const m of fresh) {
    const id = historyMessageId(m);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(m);
    }
  }
  for (const m of current) {
    const id = historyMessageId(m);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(m);
    }
  }
  return sortHistoryMessages(out);
}

export function insertHistoryMessage(list: Message[], msg: Message): { list: Message[]; isNew: boolean } {
  const id = historyMessageId(msg);
  const idx = list.findIndex(c => historyMessageId(c) === id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = msg;
    return { list: next, isNew: false };
  }
  return { list: sortHistoryMessages([...list, msg]), isNew: true };
}

export function trimHistoryMessages(list: Message[], max: number = HISTORY_MAX_CACHED_MESSAGES): Message[] {
  if (list.length <= max) return list;
  const sorted = sortHistoryMessages(list);
  return sorted.slice(sorted.length - max);
}

export function filterDeletedMessages(list: Message[], ids: Set<number>, deleteIncoming: boolean): Message[] {
  if (ids.size === 0) return list;
  return list.filter(m => {
    if (!ids.has(historyMessageId(m))) return true;
    if (deleteIncoming) return false;
    return (m as Message).out !== true;
  });
}

export function minPositiveHistoryId(list: Message[]): number {  let min = 0;
  for (const m of list) {
    const id = historyMessageId(m);
    if (id > 0 && (min === 0 || id < min)) min = id;
  }
  return min;
}

export function maxPositiveHistoryId(list: Message[]): number {
  let max = 0;
  for (const m of list) {
    const id = historyMessageId(m);
    if (id > max) max = id;
  }
  return max;
}

export function extractEmoticons(text: string): string[] {
  const out: string[] = [];
  const re = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

export function collectViewportEmoticons(
  messages: Array<{ id: number | string; message?: string }>,
  ids: number[],
  limit: number,
): string[] {
  const wanted = new Set(ids.map(Number));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (!wanted.has(Number(m?.id))) continue;
    for (const e of extractEmoticons(m?.message || '')) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
