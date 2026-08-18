export const SLOT_LOCAL_IDS: Record<string, string> = {
  back: 'slot-local-back',
  pull: 'slot-local-pull',
  reel0: 'slot-local-reel0',
  reel1: 'slot-local-reel1',
  reel2: 'slot-local-reel2',
};

export const SLOT_LOCAL_KEYS: readonly string[] = [
  SLOT_LOCAL_IDS.back,
  SLOT_LOCAL_IDS.pull,
  SLOT_LOCAL_IDS.reel0,
  SLOT_LOCAL_IDS.reel1,
  SLOT_LOCAL_IDS.reel2,
];

let jsonPromise: Promise<Record<string, string>> | null = null;

export function getSlotLocalJson(): Promise<Record<string, string>> {
  if (!jsonPromise) {
    jsonPromise = import('./slot-local-assets-data.js').then((m) => m.SLOT_LOCAL_JSON);
  }
  return jsonPromise;
}
