#!/bin/bash
set -e
source "$HOME/.cargo/env"
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${TGS_CARGO_TARGET_DIR:-$HOME/.cache/tgs-cargo-target}"
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C target-feature=+simd128" \
  wasm-pack build --release --target web --out-dir wasm --out-name tgs_wasm
echo "tgs-wasm simd128 built OK"
ls -la wasm/tgs_wasm_bg.wasm 2>/dev/null
md5sum wasm/tgs_wasm_bg.wasm 2>/dev/null
