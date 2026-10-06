# mtproto demo agent

Demo agent showing MTProto client↔server and secret-chat (Alice↔Bob) encryption round-trips through `MTProtoCryptoPlugin`.

## Run it

```bash
cd agents/mtproto
npx ts-node index.ts
```

By default the plugin routes crypto through Rust WASM (`crypton-rs WASM active`
in the log). To exercise the pure TypeScript backend instead:

```bash
CRYPTON_WASM=0 npx ts-node index.ts
```

With `CRYPTON_WASM=0` the plugin skips `initWasmCrypton()` and logs
`NOT active — falling back to JS crypto`. Anything else (including unset)
uses WASM when the binary is available.

## Tests

```bash
npx jest agents/mtproto        # demo flow on pure JS (CRYPTON_WASM=0)
npx jest plugins/mtproto       # includes crypto-wasm.test.ts (Rust backend)
```

Both backends run the same round-trips: cloud chat both directions (odd /
`mod4==3` message ids) and secret chat with complementary `isInitiator`
flags, plus the wrong-key rejection case.
