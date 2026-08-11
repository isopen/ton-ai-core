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

const idleAnims = new Map<string, { entry: WorkerAnim; ts: number }>();
const idleOrder: string[] = [];
const IDLE_MAX = 64;
const IDLE_TTL_MS = 60_000;

function idleGet(renderId: string): WorkerAnim | undefined {
  const rec = idleAnims.get(renderId);
  if (!rec) return undefined;
  if (Date.now() - rec.ts > IDLE_TTL_MS) {
    idleAnims.delete(renderId);
    const i = idleOrder.indexOf(renderId);
    if (i >= 0) idleOrder.splice(i, 1);
    return undefined;
  }
  return rec.entry;
}

function idlePromote(renderId: string, entry: WorkerAnim) {
  idleAnims.delete(renderId);
  const i = idleOrder.indexOf(renderId);
  if (i >= 0) idleOrder.splice(i, 1);
  anims.set(renderId, entry);
}

function idleInsert(renderId: string, entry: WorkerAnim) {
  idleAnims.set(renderId, { entry, ts: Date.now() });
  idleOrder.push(renderId);
  while (idleOrder.length > IDLE_MAX) {
    const oldest = idleOrder.shift()!;
    idleAnims.delete(oldest);
  }
}

const destroyedDuringLoad = new Set<string>();

function loadingFor(renderId: string): Promise<void>[] {
  return [...loading.entries()].filter(([k]) => k.split('\u0000')[0] === renderId).map(([, p]) => p);
}

async function waitForLoads(renderId: string): Promise<WorkerAnim | undefined> {
  for (let i = 0; i < 10; i++) {
    const entry = anims.get(renderId) || idleGet(renderId);
    if (entry) return entry;
    const inflight = loadingFor(renderId);
    if (inflight.length === 0) return undefined;
    await Promise.allSettled(inflight);
  }
  return anims.get(renderId) || idleGet(renderId);
}

function generation(renderId: string): number {
  return generations.get(renderId) || 0;
}

function bumpGeneration(renderId: string): number {
  const gen = generation(renderId) + 1;
  generations.set(renderId, gen);
  return gen;
}

async function load(renderId: string, tgsUrl: string, tgsJson: string | undefined, imgSize: number, isLowPriority: boolean, gen: number): Promise<void> {
  const key = renderId + '\u0000' + gen;
  const pending = loading.get(key);
  if (pending) return pending;
  const p = (async () => {
    let json: string;
    if (tgsJson) {
      json = tgsJson;
    } else {
      const resp = await fetch(tgsUrl);
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      try {
        json = ct.startsWith('text/') || ct.includes('json')
          ? await resp.text()
          : await inflateTgs(new Uint8Array(await resp.arrayBuffer()));
      } catch (err: any) {
        throw new Error('load-fetch ' + tgsUrl + ' status=' + resp.status + ' ct=' + ct + ': ' + String(err?.message || err));
      }
    }
    let anim: ParsedAnimation;
    try {
      anim = await loadTgs(json);
    } catch (err: any) {
      throw new Error('parse-fail ' + tgsUrl + ' body=' + JSON.stringify(json.slice(0, 80)) + ': ' + String(err?.message || err));
    }
    const maxFps = isLowPriority ? 30 : 60;
    const reduceFactor = anim.fps % maxFps === 0 ? anim.fps / maxFps : 1;
    const entry: WorkerAnim = {
      anim,
      imgSize,
      reduceFactor,
      msPerFrame: 1000 / (anim.fps / reduceFactor),
      framesCount: Math.max(1, Math.ceil((anim.outFrame - anim.inFrame) / reduceFactor)),
      baseFrame: anim.inFrame,
    };
    if (generation(renderId) !== gen) {
      if (destroyedDuringLoad.has(renderId)) {
        destroyedDuringLoad.delete(renderId);
        idleInsert(renderId, entry);
      }
      return;
    }
    destroyedDuringLoad.delete(renderId);
    anims.set(renderId, entry);
  })();
  loading.set(key, p);
  try {
    await p;
  } finally {
    loading.delete(key);
  }
}

async function ensureAnimsEntry(renderId: string, tgsUrl: string, tgsJson: string | undefined, imgSize: number, isLowPriority: boolean): Promise<WorkerAnim> {
  const gen = generation(renderId);
  const existing = anims.get(renderId);
  if (existing && generation(renderId) === gen) return existing;
  const idle = idleGet(renderId);
  if (idle) {
    destroyedDuringLoad.delete(renderId);
    idlePromote(renderId, idle);
    return idle;
  }
  await load(renderId, tgsUrl, tgsJson, imgSize, isLowPriority, gen);
  const entry = anims.get(renderId);
  if (entry && generation(renderId) === gen) return entry;
  await load(renderId, tgsUrl, tgsJson, imgSize, isLowPriority, generation(renderId));
  const retryEntry = anims.get(renderId);
  if (!retryEntry) throw new Error('TGS anim missing after load: ' + renderId);
  return retryEntry;
}

function inflateAndDecode(buf: Uint8Array): Promise<string> {
  return inflateTgs(buf);
}

async function renderFrames(renderId: string, frameIndex: number): Promise<{ frameIndex: number; imageBitmap: ImageBitmap }> {
  const entry = (await waitForLoads(renderId));
  if (!entry) throw new Error('TGS anim not found: ' + renderId);
  const off = new OffscreenCanvas(entry.imgSize, entry.imgSize);
  renderFrame(off as unknown as HTMLCanvasElement, entry.anim, entry.baseFrame + frameIndex * entry.reduceFactor, 1, entry.imgSize, entry.imgSize);
  const imageData = off.getContext('2d')!.getImageData(0, 0, entry.imgSize, entry.imgSize);
  return { frameIndex, imageBitmap: await createImageBitmap(imageData) };
}

function valueOf(p: any): any {
  if (!p) return undefined;
  if (Array.isArray(p.k)) {
    if (p.k.length && typeof p.k[0] === 'object' && p.k[0]?.s !== undefined) return p.k[0].s;
    return p.k;
  }
  return p.k;
}

function dumpShape(s: any): any {
  return {
    ty: s.type,
    nm: s.name,
    hd: s.hidden || undefined,
    c: valueOf(s.color),
    o: valueOf(s.opacity),
    n: (s.children || []).length,
    it: (s.children || []).map(dumpShape),
  };
}

function dumpLayer(l: any): any {
  return {
    ty: l.type,
    i: l.index,
    nm: l.name,
    ip: l.inFrame,
    op: l.outFrame,
    st: l.startTime,
    sr: l.stretch,
    w: l.layerWidth,
    h: l.layerHeight,
    parent: l.parentIndex,
    refId: l.refId,
    text: l.text
      ? {
          t: l.text.text,
          s: l.text.fontSize,
          f: l.text.fontFamily,
          fc: l.text.fillColor,
          sc: l.text.strokeColor,
          sw: l.text.strokeWidth,
          j: l.text.justify,
          kf: (l.text.keyframes || []).length,
        }
      : undefined,
    shapes: (l.shapes || []).map(dumpShape),
    masks: (l.masks || []).length,
    tr: l.transform
      ? {
          p: valueOf(l.transform.position),
          a: valueOf(l.transform.anchor),
          s: valueOf(l.transform.scale),
          r: valueOf(l.transform.rotation),
          o: valueOf(l.transform.opacity),
        }
      : undefined,
  };
}

function dumpAnim(anim: any): any {
  return {
    w: anim.width,
    h: anim.height,
    fr: anim.fps,
    ip: anim.inFrame,
    op: anim.outFrame,
    layers: (anim.layers || []).map(dumpLayer),
    assets: (anim.assets || []).map((a: any) => ({
      id: a.id,
      w: a.w,
      h: a.h,
      hasImage: !!a.p,
      precomp: (a.layers || []).length,
      layers: (a.layers || []).map(dumpLayer),
    })),
  };
}

const dumpedRenderIds = new Set<string>();

ctx.onmessage = (e: MessageEvent) => {
  const { type, msgId, renderId, tgsUrl, tgsJson, imgSize, isLowPriority, frameIndex, debug } = (e.data || {}) as any;
  const reply = (data?: any, transfer?: Transferable[]) => {
    ctx.postMessage({ type: 'reply', msgId, ok: true, data }, transfer as any);
  };
  const fail = (error: string) => {
    ctx.postMessage({ type: 'reply', msgId, ok: false, error });
  };
  (async () => {
    try {
      if (type === 'tgs:init' || type === 'tgs:changeData') {
        if (type === 'tgs:changeData') {
          bumpGeneration(renderId);
          anims.delete(renderId);
          const i = idleOrder.indexOf(renderId);
          if (i >= 0) idleOrder.splice(i, 1);
          idleAnims.delete(renderId);
        }
        const entry = await ensureAnimsEntry(renderId, tgsUrl, tgsJson, imgSize, isLowPriority);
        if (debug && !dumpedRenderIds.has(renderId)) {
          dumpedRenderIds.add(renderId);
          const a = dumpAnim(entry.anim);
          console.log('[tgs-worker] ' + renderId + ' ' + JSON.stringify(a));
          reply({ reduceFactor: entry.reduceFactor, msPerFrame: entry.msPerFrame, framesCount: entry.framesCount, animDebug: a });
          return;
        }
        reply({ reduceFactor: entry.reduceFactor, msPerFrame: entry.msPerFrame, framesCount: entry.framesCount });
      } else if (type === 'tgs:renderFrames') {
        const res = await renderFrames(renderId, frameIndex);
        reply(res, [res.imageBitmap]);
      } else if (type === 'tgs:destroy') {
        bumpGeneration(renderId);
        const entry = anims.get(renderId);
        if (entry) {
          anims.delete(renderId);
          idleInsert(renderId, entry);
        } else {
          destroyedDuringLoad.add(renderId);
        }
        reply({});
      }
    } catch (err: any) {
      fail(String((err as Error)?.message || err));
    }
  })();
};
