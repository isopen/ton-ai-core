import { normalizeEmoji } from './emoji-store.js';

const UNICODE_WHITE: Record<string, string> = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
const UNICODE_BLACK: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export function pieceTypeFromAltChess(alt: string): string | null {
  const a = normalizeEmoji((alt || '').trim());
  if (!a) return null;
  if (a.startsWith('🗿')) return 'r';
  if (a.startsWith('🐴')) return 'n';
  if (a.startsWith('🐘')) return 'b';
  if (a.startsWith('👸')) return 'q';
  if (a.startsWith('🤴')) return 'k';
  if (a.startsWith('♟') || a.startsWith('♙')) return 'p';
  const c = a[0];
  if (c === '♔' || c === '♚') return 'k';
  if (c === '♕' || c === '♛') return 'q';
  if (c === '♖' || c === '♜') return 'r';
  if (c === '♗' || c === '♝') return 'b';
  if (c === '♘' || c === '♞') return 'n';
  if (c === '♙' || c === '♟') return 'p';
  return null;
}

export function chessUnicodeFor(type: string, color: 'w' | 'b'): string {
  if (color === 'w') return UNICODE_WHITE[type] || UNICODE_WHITE.p;
  return UNICODE_BLACK[type] || UNICODE_BLACK.p;
}

export function isChessPieceAlt(alt: string): boolean {
  return !!pieceTypeFromAltChess(alt);
}

export const chessDocColor = new Map<string, 'w' | 'b'>();
export function setChessDocColor(docId: string, color: 'w' | 'b'): void {
  chessDocColor.set(String(docId), color);
}
export function getChessDocColor(docId: string): 'w' | 'b' | undefined {
  return chessDocColor.get(String(docId));
}
