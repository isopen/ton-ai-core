import { S } from '@ton-ai/gram-ui';

export function genId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

export const TYPING_TIMEOUT = 10000;
export const TYPING_SEND_INTERVAL = 5000;
export const MESSAGE_CACHE_PREFIX = 'messages_';
export const DIALOG_CACHE_KEY = 'dialogs';
export const ORPHANED_KEY = 'tg_orphaned_dialogs';
export const LANG_CACHE_VERSION = 'v3';

export const ACTION_KEYS: Record<string, string> = {
  'sendMessageTypingAction': S.ACTION_TYPING,
  'sendMessageUploadPhotoAction': S.ACTION_SENDING_PHOTO,
  'sendMessageRecordVideoAction': S.ACTION_RECORDING_VIDEO,
  'sendMessageUploadVideoAction': S.ACTION_SENDING_VIDEO,
  'sendMessageRecordAudioAction': S.ACTION_RECORDING_AUDIO,
  'sendMessageUploadAudioAction': S.ACTION_SENDING_AUDIO,
  'sendMessageUploadDocumentAction': S.ACTION_SENDING_FILE,
  'sendMessageGeoLocationAction': S.ACTION_SENDING_LOCATION,
  'sendMessageChooseStickerAction': S.ACTION_CHOOSING_STICKER,
  'sendMessageGamePlayAction': S.ACTION_PLAYING_GAME,
  'sendMessageRecordRoundAction': S.ACTION_RECORDING_ROUND,
  'sendMessageUploadRoundAction': S.ACTION_SENDING_ROUND,
};

export const LANG_CODE_MAP: Record<string, string> = {
  'zh': 'zh-hans',
  'zh-TW': 'zh-hant',
  'pt': 'pt-br',
  'pt-PT': 'pt-pt',
};
