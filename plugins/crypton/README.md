# crypton

Cryptography primitives for TON AI Framework, extracted from `@ton-ai/core`.
Consumers import the `crypton` namespace object:

```text
import { crypton } from '@ton-ai/crypton';
```

## Build

```text
npm run build -w @ton-ai/crypton
```

The build copies the prebuilt WebAssembly artifacts from `src/wasm`
(next to `dist`, same as before the move) — build them first if missing:

```text
bash src/rust/build.sh
```

## Tests

```text
npx jest plugins/crypton/tests/
```
