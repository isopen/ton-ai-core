export type MediaSourceMap = Record<number | string, string> | undefined;

export const GLYPH_SOURCE = 'glyph';

export const UNKNOWN_SOURCE = 'unknown';

export const DOC_SOURCE_PREFIXES = ['emojipack-', 'emoji-'];

export function resolveKeyedSource(key: string, sources: MediaSourceMap, fallback: string = UNKNOWN_SOURCE): string | undefined {
  if (!key) return fallback;
  return sources?.[key] || fallback;
}

export function lookupDocumentSource(docId: string | number | undefined, sources: MediaSourceMap, prefixes: readonly string[] = DOC_SOURCE_PREFIXES): string | undefined {
  if (docId == null || docId === '') return undefined;
  const id = String(docId);
  for (const prefix of prefixes) {
    const found = sources?.[prefix + id];
    if (found) return found;
  }
  return sources?.[id];
}

export function resolveEmojiSource(docId: string | number | undefined, sources: MediaSourceMap, prefixes?: readonly string[]): string {
  if (docId == null || docId === '') return GLYPH_SOURCE;
  return lookupDocumentSource(docId, sources, prefixes) || UNKNOWN_SOURCE;
}

export function resolveStickerSource(key: string, sources: MediaSourceMap): string {
  return resolveKeyedSource(key, sources, UNKNOWN_SOURCE) as string;
}
