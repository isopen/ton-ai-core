# tgs dev tools

Developer-only scripts for the `tgs` plugin: corpus download, benchmarks, profiling,
pixel comparison and renderer smoke tests. Nothing here is shipped with the package
(`package.json` publishes `dist` only).

Run every script from the plugin directory unless stated otherwise:

```bash
cd plugins/tgs
```

## Examples

Full corpus, sequential: honest performance numbers (about 80 min on 4 CPUs):

```bash
TGS_CORPUS_EQ=off node tools/bench-corpus.mjs /home/user/Documents/tgs_data
```

Writes three pack tables (64 / 320 / 720 px) to `tmp/tgs-corpus-bench.html`.

Full corpus, parallel: full coverage plus ok/eq/error counters (timings are
inflated by CPU contention, so compare ratios only):

```bash
TGS_CORPUS_WORKERS=3 TGS_CORPUS_EQ=off node tools/bench-corpus-parallel.mjs /home/user/Documents/tgs_data
```

Writes `tmp/tgs-corpus-bench-parallel.html` in the same three-table format.

Quick sample instead of the whole corpus (stratified, so every pack is represented):

```bash
TGS_CORPUS_MAX=2000 TGS_CORPUS_EQ=off node tools/bench-corpus.mjs /home/user/Documents/tgs_data
```

One render size only, fewer frames per file:

```bash
TGS_SIZES=320 TGS_LOTTIE_FRAMES=10 node tools/bench-corpus.mjs /home/user/Documents/tgs_data
```

Fast checks that do not touch the full corpus:

```bash
node tools/render-smoke.mjs /home/user/Documents/tgs_data --limit 5
node tools/pixel-diff.mjs /home/user/Documents/tgs_data --size 64 --frames 6 --limit 200
node tools/png-dump.mjs /home/user/Documents/tgs_data/ABCEmoji/5226734466315067436.tgs 0 512 /tmp/opencode/pngcheck
node tools/profile-render.mjs /home/user/Documents/tgs_data
```

Every long-running tool prints a live status line that advances pack by pack:

```text
[corpus-bench] packs 17/345 [##------------------] | files 812/16646 4.9% | 11.5 f/s | 1m 10s elapsed | eta 22m 46s | pack LoveBirds 12/31
```

On a TTY the line is rewritten in place; when the output is piped or redirected
it is printed as a new line every `TGS_CORPUS_STATUS_MS` (default 5000 ms).
`TGS_CORPUS_STATUS=0` disables it.

## Prerequisites

| Dependency | Needed by | Build |
|---|---|---|
| `src/rust/wasm/tgs_wasm.js` + `tgs_wasm_bg.wasm` | renderer benches, profiling, pixel tools, smoke | `bash src/rust/build.sh` |
| `dist/ts/index.js` | `TGS_BENCH_TS=1` (TypeScript parser) | `npm run build -w @ton-ai/tgs` |
| `tools/vendor/tlottie.wasm` | tlottie reference in benches and pixel tools | vendored, already present |
| `.tgs` corpus | benches, inventory, pixel tools, smoke | `tools/dump-tgs-corpus.js` |

Several tools default to `/home/user/Documents/tgs_data`; pass the corpus path
explicitly when yours differs. Zero-byte `.tgs` files are skipped by the corpus scan.

`src/rust/build.sh` also writes a profiling build with `prof` exports to
`~/.cache/tgs-wasm-prof` (override with `TGS_PROF_DIR`).

## Quick reference

| Tool | Purpose | Command |
|---|---|---|
| `bench-corpus.mjs` | Sequential corpus benchmark, HTML + JSON, one table per render size | `node tools/bench-corpus.mjs <corpus-dir>` |
| `bench-corpus-parallel.mjs` | Same report split across worker threads | `TGS_CORPUS_WORKERS=4 node tools/bench-corpus-parallel.mjs <corpus-dir>` |
| `bench.mjs` | Parse-only benchmark: TS vs Rust/WASM JSON backends | `node tools/bench.mjs <corpus-dir>` |
| `bench-vs-tl.mjs` | Render benchmark of selected packs vs tlottie | `node tools/bench-vs-tl.mjs [corpus-dir]` |
| `profile-render.mjs` | Wasm phase profile per pack (needs prof build) | `node tools/profile-render.mjs [corpus-dir]` |
| `inventory-corpus.mjs` | Feature census over the corpus | `node tools/inventory-corpus.mjs <corpus-dir>` |
| `pixel-diff.mjs` | Alpha agreement vs tlottie, per file | `node tools/pixel-diff.mjs <path> --size 64` |
| `png-dump.mjs` | Dump ours/tlottie/diff PNGs for one frame | `node tools/png-dump.mjs <file.tgs> [frame] [size] [outdir]` |
| `render-compare-debug.mjs` | Per-frame opaque pixel counts, ours vs tlottie | `node tools/render-compare-debug.mjs <file.tgs> [size] [frames]` |
| `render-smoke.mjs` | Fast renderer sanity check, non-zero exit on failure | `node tools/render-smoke.mjs <path> --limit 5` |
| `gen-quality-fixtures.mjs` | Regenerate renderer quality fixtures | `node tools/gen-quality-fixtures.mjs` |
| `dump-tgs-corpus.js` | Download the benchmark corpus (runs in browser console) | paste into gram-browser DevTools |

`package.json` shortcuts: `npm run bench`, `npm run bench:corpus`, `npm run smoke`,
`npm run pixel:diff`, `npm run png:dump`.

## bench-corpus.mjs

Sequential corpus benchmark in the layout of the tlottie
`android-fold.html` page: one pack table per render size
(`TGS_SIZES`, default `64,320,720`), plus per-pack file details and the slowest
files for each size. Output defaults to `tmp/tgs-corpus-bench.html` in the repo root.

```bash
node tools/bench-corpus.mjs /home/user/Documents/tgs_data
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `TGS_SIZES` | `64,320,720` | Render sizes (long side, px), one table each |
| `TGS_CORPUS_RUNS` | `1` | Parse runs per file |
| `TGS_CORPUS_LOAD_RUNS` | `max(3,runs)` | Load samples per file, minimum reported |
| `TGS_CORPUS_MAX` | `0` | Stratified cap on file count (`0` = all) |
| `TGS_CORPUS_EQ` | `fp` | TS vs wasm parity check: `fp`, `deep`, `off` |
| `TGS_BENCH_TS` | off | Also parse with the TS backend (adds ts/wasm/eq columns) |
| `TGS_BENCH_WASM` | on | `0` disables the Rust/WASM backend |
| `TGS_BENCH_TL` | on | `0` disables the tlottie reference |
| `TGS_LOTTIE_FRAMES` | `30` | Frames rendered per file by tlottie |
| `TGS_LOTTIE_TOLERANCE` | `0.3` | tlottie curve tolerance |
| `TGS_OURS_FRAMES` | `TGS_LOTTIE_FRAMES` | Frames rendered per file by our renderer |
| `TGS_CORPUS_OUT` | `tmp/tgs-corpus-bench.html` | HTML path, empty string skips HTML |
| `TGS_CORPUS_JSON` | none | Optional JSON summary path |
| `TGS_CORPUS_PROGRESS` | `250` | Detailed log line every N files, `0` disables |
| `TGS_CORPUS_STATUS_MS` | tty `250`, pipe `5000` | Live status refresh interval in ms |
| `TGS_CORPUS_STATUS` | on | `0` disables the live status line |

Measurement notes:

- `load` is not the same operation for both backends. Ours = UTF-8 encode +
  JSON to model + render instance + pixel buffer; tlottie = uploaded bytes to model.
  tlottie load does not depend on output size, so it is measured once per file and
  shared across the size tables.
- Deltas are wall time for the same operation; positive means ours is slower.
- `eq` compares the TS and WASM parse results when `TGS_BENCH_TS=1`.

## bench-corpus-parallel.mjs

Identical measurement, aggregation and HTML as `bench-corpus.mjs`, split across
`worker_threads` with `bench-corpus-worker.mjs`. Use it for coverage and
ok/eq/error counters on the full corpus. Absolute timings are inflated by CPU
contention, so compare ratios and use the sequential script for performance.

```bash
TGS_CORPUS_WORKERS=4 node tools/bench-corpus-parallel.mjs /home/user/Documents/tgs_data
```

Output defaults to `tmp/tgs-corpus-bench-parallel.html`. All `bench-corpus.mjs`
environment variables apply, plus:

| Variable | Default | Meaning |
|---|---|---|
| `TGS_CORPUS_WORKERS` | `min(8, cpus-1)` | Worker count, `0` = auto |
| `TGS_CORPUS_WORKER_PROGRESS` | `5` | Files between worker progress messages |

The live status line aggregates per-pack counters from all workers, so packs and
files advance in the console the same way as in the sequential run.

`TGS_BENCH_TS` is opt-in here too; without it the worker does not load `dist/ts`
and the report omits the ts/wasm/eq columns.

## bench.mjs

Parse-only benchmark across the corpus: TypeScript parser vs the Rust/WASM JSON
backends. Prints a per-file table and a corpus summary (throughput, p50/p95,
parity). Requires the prod wasm glue in `src/rust/wasm`.

```bash
node tools/bench.mjs /home/user/Documents/tgs_data
```

| Variable | Default | Meaning |
|---|---|---|
| `TGS_BENCH_RUNS` | `7` | Runs per file |
| `TGS_BENCH_MAX` | `0` | Stratified sample cap (`0` = all) |
| `TGS_BENCH_QUIET` | off | Suppress per-file lines |
| `TGS_BENCH_WASM` | on | `0` disables the WASM backend |

Columns: `ts` (TypeScript), `wb` (wasm binary, lex-first), `wl` (wasm lex explicit),
`w` (wasm serde JSON), `wj` (wasm + `JSON.parse`), `eq` (`wb == serde`),
`beq` (bytes lex == serde).

## bench-vs-tl.mjs

Renders a sample of selected packs through our renderer and the vendored tlottie,
then prints per-pack frame rates and a total `ours/tl` ratio.

```bash
node tools/bench-vs-tl.mjs /home/user/Documents/tgs_data
```

| Variable | Default | Meaning |
|---|---|---|
| `TGS_VS_PACKS` | built-in list | Comma-separated pack names |
| `TGS_VS_PER_PACK` | `6` | Files per pack |
| `TGS_VS_FRAMES` | `30` | Frames per file |
| `TGS_VS_SIZE` | `512` | Render size (px) |

## profile-render.mjs

Per-pack phase profile from the `prof` wasm build: interp, shape, trim, paint,
fill, stroke, prep, raster sub-phases, geometry counters. Requires the prof build
produced by `src/rust/build.sh`.

```bash
node tools/profile-render.mjs /home/user/Documents/tgs_data
```

| Variable | Default | Meaning |
|---|---|---|
| `TGS_PROFILE_GLUE` | `~/.cache/tgs-wasm-prof` | Prof wasm glue directory |
| `TGS_PROFILE_PACKS` | built-in list | Comma-separated pack names |
| `TGS_PROFILE_PER_PACK` | `10` | Files per pack |
| `TGS_PROFILE_FRAMES` | `30` | Frames per file |
| `TGS_PROFILE_SIZE` | `64` | Render size (px) |

## inventory-corpus.mjs

Walks the corpus (gunzip, JSON parse, layer/shape tree scan) and prints a JSON
report of which Lottie features actually occur: layer types, shape types,
animated properties, mattes, precomps, repeaters and similar. Used to scope
renderer work.

```bash
node tools/inventory-corpus.mjs /home/user/Documents/tgs_data
```

| Variable | Default | Meaning |
|---|---|---|
| `TGS_INV_MAX` | `0` | Stop after N files (`0` = all) |
| `TGS_INV_OUT` | none | Write the JSON report to a file |
| `TGS_INV_PROGRESS` | `500` | Log every N files |

## pixel-diff.mjs

Renders corpus files through tlottie and our `TgsRender` at matching dimensions
and frames, then reports per-file and aggregate alpha agreement, worst files first.

```bash
node tools/pixel-diff.mjs /home/user/Documents/tgs_data --size 64 --frames 6 --limit 200
```

Flags: `--size` (default 64), `--frames` (6), `--limit` (200), `--json <path>`,
`--worst <n>` (10).

## png-dump.mjs

Renders one frame through both engines at full size and writes three PNGs
(ours, tlottie, absolute diff) without external dependencies.

```bash
node tools/png-dump.mjs path/to/file.tgs 0 512 /tmp/opencode/pngcheck
```

Arguments: file, frame (0), size (512), output directory
(`/tmp/opencode/pngcheck`).

## render-compare-debug.mjs

Quick per-frame comparison of opaque pixel counts for a single file, ours vs
tlottie. Useful when a file looks different or blank.

```bash
node tools/render-compare-debug.mjs path/to/file.tgs 512 4
```

Arguments: file, size (512), frames (4).

## render-smoke.mjs

Fast renderer smoke test: loads and renders a few frames of corpus files at a
small size and fails on empty output or errors.

```bash
node tools/render-smoke.mjs /home/user/Documents/tgs_data --limit 5
```

Flags: `--size` (64), `--frames` (8), `--limit` (5), `--list <file>` (explicit
file list). Exits non-zero when any file fails.

## gen-quality-fixtures.mjs

Regenerates the Lottie fixtures used by the Rust and jest quality suites:
`emoji_features.json` (gradients, gradient/dashed strokes, trim paths, repeaters,
masks, mattes, precomps, time remap, blend modes, hold and spatial keyframes,
all shape types, even-odd fills) and `static_badge.json` (frame-invariant fast
path). Writes to `src/rust/tests/fixtures/` and `src/ts/tests/fixtures/`.

```bash
node tools/gen-quality-fixtures.mjs
```

## dump-tgs-corpus.js

Browser tool, not a Node script. Open a logged-in gram-browser dev build in a
secure context (`http://localhost:8080`), paste the file into the DevTools
console, and pick a target folder. Files are written as
`<folder>/<set-short-name>/<docId>.tgs` plus `manifest.jsonl` in the folder root.

Default scope is exactly the 347 sticker sets of the tlottie
`android-fold.html` benchmark (the `720px effects` table is a subset). Existing
non-empty files are skipped, so a plain re-run resumes and re-downloads the
zero-byte leftovers. Stop with `window.__corpusAbort = true`.

Configuration via `window.__CORPUS_CFG = { ... }` before pasting:

| Key | Default | Meaning |
|---|---|---|
| `all` | `false` | Full catalog discovery instead of the benchmark pack list |
| `packs` | `null` | Explicit list; entries may be `'Name'`, `{ short_name, input }` or `{ short_name, effects: true }` |
| `target` | `0` | Cap on downloaded files (`0` = no cap) |
| `setConc` | `3` | Parallel set fetch/download pipelines |
| `setDelay` | `200` | Delay between sets (ms) |
| `qDelay` | `250` | Delay between catalog RPC calls (ms) |
| `extended` | `false` | Also scan name combinations and emoji queries |
| `altCap` | `300` | Search queries per extra catalog round |
| `maxRounds` | `4` | Extra catalog rounds |
| `missingOnly` | `false` | Process only sets that still contain empty/tiny files |
| `floodRetries` | `4` | Extra attempts after `FLOOD_WAIT` |
| `probe` | `false` | Run only the write-permission probe and exit |
| `sbFallback` | `'auto'` | Save Safe Browsing-blocked payloads as `.part` (`'on'`/`'off'` to force) |
| `sbExt` | `'.part'` | Suffix for blocked payloads |

The `message_effects` benchmark entry has no public short name and is not a
sticker set; fetch it from `messages.getAvailableEffects`:

```js
window.__CORPUS_CFG = { packs: [{ short_name: 'message_effects', effects: true }] };
```

Chrome's File System Access after-write check can reject `close()` with
`AbortError: Blocked by Safe Browsing`. The download itself succeeds; with
`sbFallback: 'auto'` the payload is saved as `<id>.tgs.part` instead. Rename
afterwards:

```bash
find <dir> -name '*.tgs.part' -exec sh -c 'mv "$1" "${1%.part}"' _ {} \;
```

## Outputs

Generated reports are written to `tmp/` in the repo root by default and are not
part of the package:

- `tmp/tgs-corpus-bench.html` - sequential corpus report
- `tmp/tgs-corpus-bench-parallel.html` - parallel corpus report
- `tmp/tgs-corpus-bench.json` - optional JSON summary (`TGS_CORPUS_JSON`)
