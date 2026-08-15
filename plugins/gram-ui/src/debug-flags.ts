// Центральный файл управления дебаг-логами. Каждый флаг независимо
// включает/выключает логи своей области. Меняй значения здесь — не в коде.

export const DEBUG = {
  slot: true, // [slot] — состояние слот-машины
  slotLayer: true, // [slot-layer] — слои слот-машины
  tgs: false, // [TGS_LOG] — TgsPlayer (parse/draw)
  tgsRenderer: false, // [tgs] — animated-renderer (frames/paint)
  aniSticker: false, // [ani-sticker] — animated-sticker
  emojiText: false, // [TGS_LOG] EmojiInline fetch
  photo: false, // [PhotoBubble] — рендер фото
  mediaCollage: false, // media-collage
  telegramImage: false, // [TelegramImage] — загрузка фото
} as const;

export type DebugArea = keyof typeof DEBUG;

export function debugLog(area: DebugArea, ...args: unknown[]): void {
  if (DEBUG[area]) console.log(...args);
}
