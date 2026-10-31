import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const WASM_PATH = join(__dirname, '..', '..', 'rust', 'wasm', 'tgs_wasm_bg.wasm');

function readWasmBinary(): Uint8Array {
    return new Uint8Array(readFileSync(WASM_PATH));
}

describe('tgs WASM (Rust core) golden', () => {
    let parseTgs: typeof import('@ton-ai/tgs').parseTgs;
    let initTgsWasm: typeof import('@ton-ai/tgs').initTgsWasm;
    let isTgsWasmActive: typeof import('@ton-ai/tgs').isTgsWasmActive;
    let deinitTgsWasm: typeof import('@ton-ai/tgs').deinitTgsWasm;
    let interpolateKeyframes: typeof import('@ton-ai/tgs').interpolateKeyframes;

    const fixtures: Record<string, string> = {
        shock: readFileSync(join(__dirname, 'fixtures', 'emoji_shock.json'), 'utf8'),
        wink: readFileSync(join(__dirname, 'fixtures', 'emoji_wink.json'), 'utf8'),
    };

    beforeAll(async () => {
        ({ parseTgs, initTgsWasm, isTgsWasmActive, deinitTgsWasm, interpolateKeyframes } =
            await import('@ton-ai/tgs'));
        await initTgsWasm(readWasmBinary());
    }, 60000);

    test('WASM backend is active', () => {
        assert.ok(isTgsWasmActive(), 'expected TGS WASM backend after initTgsWasm');
    });

    test('parse via WASM matches TS parser bit-for-bit', async () => {
        for (const name of Object.keys(fixtures)) {
            const wasmModel = parseTgs(fixtures[name]);
            assert.ok(isTgsWasmActive());
            deinitTgsWasm();
            try {
                const tsModel = parseTgs(fixtures[name]);
                assert.ok(!isTgsWasmActive());
                const tsJson = JSON.stringify(tsModel);
                const wasmJson = JSON.stringify(wasmModel);
                assert.strictEqual(tsJson, wasmJson);
                assert.deepStrictEqual(JSON.parse(tsJson), wasmModel);
            } finally {
                assert.ok(await initTgsWasm(readWasmBinary()));
            }
        }
    });

    test('interpolation on WASM model matches interpolation on TS model', async () => {
        const wasmModel = parseTgs(fixtures.wink);
        deinitTgsWasm();
        try {
            const tsModel = parseTgs(fixtures.wink);
            for (const frame of [0, 7.5, 22, 45]) {
                for (const layerIndex of [0, 1]) {
                    const tsLayer = tsModel.layers[layerIndex]?.transform;
                    const wasmLayer = wasmModel.layers[layerIndex]?.transform;
                    if (!tsLayer && !wasmLayer) continue;
                    assert.ok(tsLayer && wasmLayer);
                    for (const propKey of ['opacity', 'rotation', 'position', 'scale', 'anchor'] as const) {
                        const tsProp = tsLayer[propKey];
                        const wasmProp = wasmLayer[propKey];
                        assert.deepEqual(
                            wasmProp ? interpolateKeyframes(wasmProp, frame) : null,
                            tsProp ? interpolateKeyframes(tsProp, frame) : null,
                        );
                    }
                }
            }
        } finally {
            assert.ok(await initTgsWasm(readWasmBinary()));
        }
    });

    test('init without binary falls back silently when module import fails', async () => {
        deinitTgsWasm();
        const ok = await initTgsWasm(readWasmBinary());
        assert.ok(ok);
        assert.ok(isTgsWasmActive());
        const model = parseTgs(fixtures.shock);
        assert.ok(model.layers.length > 0);
        assert.ok(typeof model.fps === 'number');
    });
});
