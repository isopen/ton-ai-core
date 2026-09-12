export { TelegramUI } from './telegram-ui.js';
export type { TelegramUICallbacks } from './telegram-ui.js';
export type { PeerInfo, Dialog, Message, AppState, ImageSpec, ImageSource, ImageProps } from './types.js';
export type { TelegramImageProps } from './types.js';
export { Image } from './primitives/image.js';
export { MediaCollage } from './components/media-collage.js';
export type { MediaCollageItem } from './components/media-collage.js';
export { MediaViewer } from './components/media-viewer.js';
export { collectCustomIds } from './components/rich-message.js';
export { getEmojiAlt, matchEmojiRuns, isEmojiAtTextOffset } from './components/emoji-store.js';
export { TgsPlayer } from './components/tgs-player.js';
export { FpsMeter } from './components/fps-meter.js';
export { startFpsLogging } from './utils/fps-log.js';
export { buildPeerBlurThumb } from './utils.js';
export { requestPhoto, requestDocument, requestDocumentThumb, photoAvailability, bestSourceUrl } from './components/media-source.js';
export type { PhotoDownloadNeed, PhotoRequestOptions, DocumentRequestOptions, PhotoAvailability } from './components/media-source.js';
export { QrCode, QrCodeDefaults, QrCodeLimits } from './primitives/qr-code.js';
export type { QrCodeProps } from './primitives/qr-code.js';
export {
  QR_DEFAULTS,
  QR_LIMITS,
  validateQrValue,
  validateQrOptions,
  clampQrOptions,
  isValidHex,
  isValidTgUrl,
  isValidColor,
  hexToBase64Url,
  makeQrUrl,
  isValidTokenHex,
  generateQrDataUrl,
  generateQrToCanvas,
  generateQrSvgString,
  generateQrToOffscreen,
  getQrModule,
  preloadQrModule,
  scheduleQrPreload,
  getThemedQrColors,
  getCurrentTheme,
} from './utils/qr.js';
export type { QrOptions, QrValidatedOptions, QrErrorCorrectionLevel } from './utils/qr.js';
