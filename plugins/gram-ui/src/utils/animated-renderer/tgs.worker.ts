import { loadTgs, renderFrame, inflateTgs } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

const ctx = self as unknown as Worker;

interface WorkerAnim {
  anim: ParsedAnimation;
  imgSize: number;
  reduceFactor: number;
  msPerFrame: number;
  framesCount: number;
  baseFrame: number;
}

const anims = new Map<string, WorkerAnim>();
const loading = new Map<string, Promise<void>>();
const generations = new Map<string, number>();

function generation(renderId: string): number {
  return generations.get(renderId) || 0;
}

function bumpGeneration(renderId: string): number {
  const gen = generation(renderId) + 1;
  generations.set(renderId, gen);
  return gen;
}

async function load(renderId: string, tgsUrl: string, imgSize: number, isLowPriority: boolean, gen: number): Promise<void> {
  const key = renderId + '\u0000' + gen;
  const pending = loading.get(key);
  if (pending) return pending;
  const p = (async () => {
    const resp = await fetch(tgsUrl);
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    let json: string;
    try {
      json = ct.startsWith('text/') || ct.includes('json')
        ? await resp.text()
        : await inflateTgs(new Uint8Array(await resp.arrayBuffer()));
    } catch (err: any) {
      throw new Error('load-fetch ' + tgsUrl + ' status=' + resp.status + ' ct=' + ct + ': ' + String(err?.message || err));
    }
    let anim: ParsedAnimation;
    try {
      anim = await loadTgs(json);
    } catch (err: any) {
      throw new Error('parse-fail ' + tgsUrl + ' status=' + resp.status + ' ct=' + ct + ' body=' + JSON.stringify(json.slice(0, 80)) + ': ' + String(err?.message || err));
    }
    if (generation(renderId) !== gen) return;
    const maxFps = isLowPriority ? 30 : 60;
    const reduceFactor = anim.fps % maxFps === 0 ? anim.fps / maxFps : 1;
    anims.set(renderId, {
      anim,
      imgSize,
      reduceFactor,
      msPerFrame: 1000 / (anim.fps / reduceFactor),
      framesCount: Math.max(1, Math.ceil((anim.outFrame - anim.inFrame) / reduceFactor)),
      baseFrame: anim.inFrame,
    });
  })();
  loading.set(key, p);
  try {
    await p;
  } finally {
    loading.delete(key);
  }
}

async function ensureAnimsEntry(renderId: string, tgsUrl: string, imgSize: number, isLowPriority: boolean): Promise<WorkerAnim> {
  const gen = generation(renderId);
  await load(renderId, tgsUrl, imgSize, isLowPriority, gen);
  const entry = anims.get(renderId);
  if (entry && generation(renderId) === gen) return entry;
  await load(renderId, tgsUrl, imgSize, isLowPriority, generation(renderId));
  const retryEntry = anims.get(renderId);
  if (!retryEntry) throw new Error('TGS anim missing after load: ' + renderId);
  return retryEntry;
}

function inflateAndDecode(buf: Uint8Array): Promise<string> {
  return inflateTgs(buf);
}

async function renderFrames(renderId: string, frameIndex: number): Promise<{ frameIndex: number; imageBitmap: ImageBitmap }> {
  const entry = anims.get(renderId);
  if (!entry) throw new Error('TGS anim not found: ' + renderId);
  const off = new OffscreenCanvas(entry.imgSize, entry.imgSize);
  renderFrame(off as unknown as HTMLCanvasElement, entry.anim, entry.baseFrame + frameIndex * entry.reduceFactor, 1, entry.imgSize, entry.imgSize);
  const imageData = off.getContext('2d')!.getImageData(0, 0, entry.imgSize, entry.imgSize);
  return { frameIndex, imageBitmap: await createImageBitmap(imageData) };
}

ctx.onmessage = (e: MessageEvent) => {
  const { type, msgId, renderId, tgsUrl, imgSize, isLowPriority, frameIndex } = (e.data || {}) as any;
  const reply = (data?: any, transfer?: Transferable[]) => {
    ctx.postMessage({ type: 'reply', msgId, ok: true, data }, transfer as any);
  };
  const fail = (error: string) => {
    ctx.postMessage({ type: 'reply', msgId, ok: false, error });
  };
  (async () => {
    try {
      if (type === 'tgs:init' || type === 'tgs:changeData') {
        if (type === 'tgs:changeData') { bumpGeneration(renderId); anims.delete(renderId); }
        const entry = await ensureAnimsEntry(renderId, tgsUrl, imgSize, isLowPriority);
        reply({ reduceFactor: entry.reduceFactor, msPerFrame: entry.msPerFrame, framesCount: entry.framesCount });
      } else if (type === 'tgs:renderFrames') {
        const res = await renderFrames(renderId, frameIndex);
        reply(res, [res.imageBitmap]);
      } else if (type === 'tgs:destroy') {
        bumpGeneration(renderId);
        anims.delete(renderId);
        reply({});
      }
    } catch (err: any) {
      fail(String((err as Error)?.message || err));
    }
  })();
};
