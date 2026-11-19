// Shared helpers for the native TGS wasm render backend (dual-path with canvas).
// The worker and the main-thread renderer use this module; the actual backend is
// picked per animation and falls back to the canvas path per frame on errors.
import { getLogger } from '@ton-ai/gram-debug';
import { initTgsWasm, isTgsNativeRenderActive, tgsWasmRenderSupports, wasmCreateTgsRender } from '@ton-ai/tgs';
import type { ParsedAnimation, TgsWasmRender } from '@ton-ai/tgs';

const log = getLogger('gram-ui:tgs');

export type NativeBackend = 'auto' | 'canvas' | 'wasm';

/** Set (globalThis as any).__TGS_NATIVE_RENDER = 'canvas' to force the canvas 2D
 * path; 'wasm' forces the native path; 'auto' (default) prefers native. */
export function nativeBackendPref(): NativeBackend {
    const v = String((globalThis as any).__TGS_NATIVE_RENDER || 'auto').toLowerCase();
    if (v === 'canvas' || v === 'wasm') return v;
    return 'auto';
}

let wasmInitPromise: Promise<void> | null = null;

/** Activate the tgs wasm module once per realm (worker or page). */
export function ensureTgsWasmActive(): Promise<void> {
    if (!wasmInitPromise) {
        wasmInitPromise = initTgsWasm()
            .then((ok) => {
                if (!ok) log.info('[tgs-wasm] module not active, native render backend disabled');
            })
            .catch((err) => {
                log.info('[tgs-wasm] init failed, canvas fallback', err);
            });
    }
    return wasmInitPromise;
}

/** Create a native render instance when the backend allows, the wasm module is
 * active and the animation is in v1 scope (no text/image layers). */
export function createNativeRender(backend: NativeBackend, json: string, anim: ParsedAnimation, size: number): TgsWasmRender | undefined {
    if (backend === 'canvas') return undefined;
    if (!isTgsNativeRenderActive() || !tgsWasmRenderSupports(anim)) return undefined;
    const inst = wasmCreateTgsRender(json, size, size) || undefined;
    if (!inst && backend === 'wasm') log.info('[tgs-wasm] forced wasm backend unavailable, canvas fallback');
    return inst;
}

/** Convert premultiplied RGBA (native wasm renderer output) to unpremultiplied
 * RGBA that ImageData/putImageData expect. */
export function unpremultiply(bytes: Uint8Array, dst: Uint8ClampedArray): void {
    for (let i = 0; i < bytes.length; i += 4) {
        const a = bytes[i + 3];
        if (a === 0) continue;
        if (a === 255) {
            dst[i] = bytes[i];
            dst[i + 1] = bytes[i + 1];
            dst[i + 2] = bytes[i + 2];
            dst[i + 3] = 255;
        } else {
            const f = 255 / a;
            dst[i] = Math.min(255, Math.round(bytes[i] * f));
            dst[i + 1] = Math.min(255, Math.round(bytes[i + 1] * f));
            dst[i + 2] = Math.min(255, Math.round(bytes[i + 2] * f));
            dst[i + 3] = a;
        }
    }
}

/** Render one frame through a native instance into ImageData-compatible pixels.
 * Returns null when the instance is unusable (caller falls back to canvas). */
export function wasmFrameImageData(
    inst: TgsWasmRender,
    frame: number,
    w: number,
    h: number,
): { data: Uint8ClampedArray<ArrayBuffer>; empty: boolean } | null {
    const bytes = inst.frame_bytes(frame, w, h);
    if (!bytes) return null;
    let empty = true;
    for (let i = 3; i < bytes.length; i += 4) {
        if (bytes[i] !== 0) { empty = false; break; }
    }
    const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    unpremultiply(bytes, data);
    return { data, empty };
}
