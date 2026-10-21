import { readFileSync } from 'fs';
import { join } from 'path';

const WASM_PATH = join(__dirname, '..', 'rust', 'wasm', 'crypton_wasm_bg.wasm');

export function readWasmBinary(): Uint8Array {
  return new Uint8Array(readFileSync(WASM_PATH));
}
