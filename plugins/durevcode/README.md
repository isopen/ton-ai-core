# durevcode

TypeScript plugin for TON AI Core backed by the `durev-core` Rust engine. No opencode dependency. All free models are called directly.

## Build

```text
cargo build --release --manifest-path plugins/durevcode/rust/Cargo.toml
npm run build -w @ton-ai/durevcode
```

Release binary lands at `plugins/durevcode/rust/target/release/durev`.

Optional WebAssembly build of the pure core (diff stat, models, codecs):

```text
wasm-pack build plugins/durevcode/rust --target web --out-dir ../wasm --out-name durev_wasm -- --no-default-features --features wasm
```

## Free models

Resolution lives in `rust/src/models.rs` and is mirrored in `src/components.ts`:

| Model | Provider | Endpoint |
|---|---|---|
| big-pickle | zen | chat |
| mimo-v2.5-free | zen | chat |
| mimo-v2.6-flash-free | zen | chat |
| ling-3.0-flash-fin-free | zen | chat |
| nemotron-3-ultra-free | zen | chat |
| nemotron-3.5-lightning-free | zen | chat |
| kimi-k2.5-free | zen | chat |
| minimax-m2.5-free | zen | chat |
| space-bunny-free | zen | chat |
| jev-1.13-free | zen | chat |
| muse-spark-1.3-contributor-free | zen | responses |
| *anything*`:free` | openrouter | chat |

`muse-spark-1.3-contributor-free` always uses the `/responses` endpoint. Anything ending in `:free` with a slash routes to OpenRouter, anything ending in `-free` routes to Zen.

```text
./plugins/durevcode/rust/target/release/durev models
```

## Stores

Two backends, same CLI output. The extension decides:

- flat file (any other extension): `S/E/P/Q/T` tab-separated lines
- SQLite (`.db`, `.sqlite`, `.sqlite3`): WAL mode, indexed tables

## CLI

```text
durev --version
durev models
durev session-create <store> <dir> [model]
durev session-list <store>
durev event-append <store> <session> <kind> <text>
durev event-read <store> <session> [limit]
durev perm-request <store> <session> <action> <resource>
durev perm-list <store> <session>
durev perm-reply <store> <session> <id> <once|deny>
durev question-ask <store> <session> <question> <opt1,opt2> [multiple 0|1]
durev question-list <store> <session>
durev question-reply <store> <session> <id> <label1,label2>
durev todo-put <store> <session> <content...>
durev todo-list <store> <session>
durev todo-done <store> <session> <position>
durev tool-read <root> <path> [limit]
durev tool-write <root> <path> <content>
durev tool-bash <root> <timeout_ms> <cmd> [args...]
durev tool-patch <root> <patchfile>
durev tool-run <store.db> <root> <session> <permid> <read|write|bash> [args...]
```

`tool-run` consumes a resolved `once` permission exactly one time and exits `4` on deny or reuse. All tool paths are confined to `<root>`.

Patch file blocks are separated by `===` lines:

```text
ADD notes/a.txt
line1
===
UPDATE notes/a.txt
line1
---
LINE1
===
DELETE notes/old.txt
===
```

## TypeScript API

```text
import { DurevcodePlugin } from '@ton-ai/durevcode';

const plugin = new DurevcodePlugin({
  model: 'mimo-v2.5-free',
  storePath: '~/.local/share/durev-radar/durev.db',
  zenApiKey: process.env.OPENCODE_ZEN_API_KEY,
  openrouterKey: process.env.OPENROUTER_API_KEY,
});

await plugin.analyze({ diffText });
await plugin.chat([{ role: 'user', content: 'hi' }]);
await plugin.createSession('/repo');
await plugin.requestPermission(session, 'write', 'notes/a.txt');
await plugin.runGatedTool('/repo', session, permId, 'write', ['notes/a.txt', 'hi']);
```

Without `storePath` or without the native binary the plugin falls back to equivalent in-memory TypeScript implementations.

## Tests

```text
cargo test --manifest-path plugins/durevcode/rust/Cargo.toml
npx jest plugins/durevcode/tests/durevcode.test.ts
```

## durev-radar

The Telegram agent lives in `agents/durev-radar`. Full launch instructions are in its README.
