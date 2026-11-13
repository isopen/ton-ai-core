#!/bin/bash
set -e
source "$HOME/.cargo/env"
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CRYPTON_WASM_CARGO_TARGET_DIR:-$HOME/.cache/crypton-cargo-target-w32}"
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+simd128 -C link-arg=--allow-undefined" \
  cargo build --release --target wasm32-unknown-unknown -p crypton-wasm
mkdir -p wasm
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/crypton_wasm.wasm" wasm/crypton_wasm_bg.wasm
cp glue/crypton_wasm.js wasm/crypton_wasm.js
cp glue/crypton_wasm.d.ts wasm/crypton_wasm.d.ts
cp glue/package.json wasm/package.json
echo "crypton-wasm simd128 ABI built OK"
ls -la wasm/crypton_wasm_bg.wasm
md5sum wasm/crypton_wasm_bg.wasm
