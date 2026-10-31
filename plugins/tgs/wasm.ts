import { getLogger } from '@ton-ai/gram-debug';
import type { ParsedAnimation } from './ts/src/types.js';

const log = getLogger('tgs-rust');

type TgsWasmModule = {
    parse_tgs_json: (json: string, key: string | null | undefined, cache: boolean) => string;
};

let wasmModule: TgsWasmModule | null = null;
let initPromise: Promise<boolean> | null = null;
let generation = 0;
let loggingEnabled = false;

export function enableTgsWasmLogging(v: boolean): void {
    loggingEnabled = v;
}

export function deinitTgsWasm(): void {
    generation += 1;
    wasmModule = null;
    initPromise = null;
}

export function isTgsWasmActive(): boolean {
    return wasmModule !== null;
}

export function initTgsWasm(wasmBinary?: Uint8Array): Promise<boolean> {
    if (wasmModule) return Promise.resolve(true);
    if (initPromise) return initPromise;
    const gen = generation;
    initPromise = (async () => {
        try {
            const raw: any = await import('./rust/wasm/tgs_wasm.js');
            const mod: any =
                typeof raw?.parse_tgs_json === 'function'
                    ? raw
                    : typeof raw?.default?.parse_tgs_json === 'function'
                        ? raw.default
                        : null;
            if (!mod) throw new TypeError('tgs_wasm module shape not recognized');
            let def: any = mod.default;
            let depth = 0;
            while (typeof def !== 'function' && def && typeof def === 'object' && def !== mod && depth < 3) {
                def = def.default;
                depth += 1;
            }
            const initFn: any = typeof def === 'function' ? def : (typeof mod.__wbg_init === 'function' ? mod.__wbg_init : null);
            if (typeof initFn !== 'function') throw new TypeError('tgs_wasm init export not found');
            if (wasmBinary && wasmBinary.length > 0) {
                try {
                    await initFn({ module_or_path: wasmBinary });
                } catch {
                    await initFn(wasmBinary);
                }
            } else {
                await initFn();
            }
            if (gen !== generation) return false;
            wasmModule = mod;
            if (loggingEnabled) log.info('tgs-rust WASM active (parse backend)');
            else log.info('tgs-rust WASM active (per-op logs off). Enable: enableTgsWasmLogging(true)');
            return true;
        } catch (e) {
            log.info('tgs-rust WASM init failed, falling back to TS parser: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120));
            initPromise = null;
            return false;
        }
    })();
    return initPromise;
}

export function wasmParseTgs(json: string, key?: string, cache?: boolean): ParsedAnimation | null {
    if (!wasmModule) return null;
    try {
        const raw = wasmModule.parse_tgs_json(json, key ?? null, cache === true);
        return JSON.parse(raw) as ParsedAnimation;
    } catch (e) {
        log.info('tgs-rust parse failed (' + (e instanceof Error ? e.message : String(e)).slice(0, 120) + '), retrying with TS parser');
        return null;
    }
}
