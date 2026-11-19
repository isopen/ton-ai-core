#!/bin/bash
set -e
source "$HOME/.cargo/env"
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${TGS_WASM_CARGO_TARGET_DIR:-$HOME/.cache/tgs-cargo-target-w32}"
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+simd128 -C link-arg=--allow-undefined" \
  cargo build --release --target wasm32-unknown-unknown -p tgs
mkdir -p wasm
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/tgs.wasm" wasm/tgs_wasm_bg.wasm
cp glue/tgs_wasm.js wasm/tgs_wasm.js
PROF_DIR="${TGS_PROF_DIR:-$HOME/.cache/tgs-wasm-prof}"
mkdir -p "$PROF_DIR"
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+simd128 -C link-arg=--allow-undefined" \
  cargo build --release --target wasm32-unknown-unknown -p tgs --features prof
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/tgs.wasm" "$PROF_DIR/tgs_wasm_bg.wasm"
cp glue/tgs_wasm.js "$PROF_DIR/tgs_wasm.js"
echo "tgs-wasm simd128 ABI built OK"
ls -la wasm/tgs_wasm_bg.wasm
md5sum wasm/tgs_wasm_bg.wasm