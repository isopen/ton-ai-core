/**
 * @jest-environment jsdom
 */
import { ensureStickerPack, findStickerSetForDoc, getStickerPack } from '../dist/components/picker-store.js';

function respondPack(setId: string, docs: any[]): void {
  window.addEventListener('tg-fetch-sticker-pack', (e: Event) => {
    const d = (e as CustomEvent).detail || {};
    if (String(d.setId) !== setId) return;
    window.dispatchEvent(new CustomEvent('tg-sticker-pack-ready', {
      detail: { setId, title: 'Set ' + setId, offset: 0, total: docs.length, documents: docs, packs: [], hasMore: false },
    }));
  });
}

describe('findStickerSetForDoc', () => {
  test('resolves set for loaded pack document', async () => {
    respondPack('9001', [{ id: 'doc-a', mime_type: 'image/webp' }, { id: 'doc-b', mime_type: 'image/webp' }]);
    ensureStickerPack('9001', '0');
    await new Promise((r) => setTimeout(r, 60));
    expect(getStickerPack('9001')?.documents.length).toBe(2);
    expect(findStickerSetForDoc('doc-a')).toEqual({ setId: '9001', accessHash: '0' });
    expect(findStickerSetForDoc('doc-b')?.setId).toBe('9001');
  });

  test('returns null for unknown or empty id', async () => {
    expect(findStickerSetForDoc('missing-doc')).toBeNull();
    expect(findStickerSetForDoc('')).toBeNull();
  });
});
