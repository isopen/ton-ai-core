import { getLogger } from '@ton-ai/gram-debug';
import type { ParsedAnimation } from '../ts/types.js';
import { decodeAnimation } from '../ts/bridge.js';

const log = getLogger('tgs-rust');

type TgsWasmModule = {
    parse_tgs_json: (json: string, key: string | null | undefined, cache: boolean) => string;
    parse_tgs_binary?: (json: string, key: string | null | undefined, cache: boolean) => Uint8Array;
};

let wasmModule: TgsWasmModule | null = null;
let wasmSimd = false;
let initPromise: Promise<boolean> | null = null;
let generation = 0;
let loggingEnabled = false;

export function enableTgsWasmLogging(v: boolean): void {
    loggingEnabled = v;
}

export function deinitTgsWasm(): void {
    generation += 1;
    wasmModule = null;
    wasmSimd = false;
    initPromise = null;
}

export function isTgsWasmActive(): boolean {
    return wasmModule !== null;
}

export function isTgsWasmSimd(): boolean {
    return wasmModule !== null && wasmSimd;
}

// v128.load probe module per wasm SIMD proposal spec.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 86, 1, 4, 127, 1, 124, 11]);

export function isWasmSimdSupported(): boolean {
    try {
        return WebAssembly.validate(SIMD_PROBE);
    } catch {
        return false;
    }
}

async function importTgsModule(): Promise<any> {
    const raw: any = await import('./wasm/tgs_wasm.js');
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
    return { mod, initFn };
}

async function activate(wasmBinary?: Uint8Array, gen = generation): Promise<boolean> {
    const { mod, initFn } = await importTgsModule();
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
    wasmSimd = true;
    if (loggingEnabled) log.info('tgs-rust WASM active (parse backend, simd128)');
    else log.info('tgs-rust WASM active (per-op logs off, simd128). Enable: enableTgsWasmLogging(true)');
    return true;
}

export function initTgsWasm(wasmBinary?: Uint8Array): Promise<boolean> {
    if (wasmModule) return Promise.resolve(true);
    if (initPromise) return initPromise;
    const gen = generation;
    initPromise = (async () => {
        try {
            return await activate(wasmBinary, gen);
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
        if (typeof wasmModule.parse_tgs_binary === 'function') {
            const bytes = wasmModule.parse_tgs_binary(json, key ?? null, cache === true);
            const decoded = decodeAnimation(bytes);
            if (decoded) return decoded;
            log.info('tgs-rust binary decode failed, falling back to json bridge');
        }
        const raw = wasmModule.parse_tgs_json(json, key ?? null, cache === true);
        return JSON.parse(raw) as ParsedAnimation;
    } catch (e) {
        log.info('tgs-rust parse failed (' + (e instanceof Error ? e.message : String(e)).slice(0, 120) + '), retrying with TS parser');
        return null;
    }
}
