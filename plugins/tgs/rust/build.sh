#!/bin/bash
set -e
source "$HOME/.cargo/env"
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${TGS_CARGO_TARGET_DIR:-$HOME/.cache/tgs-cargo-target}"
wasm-pack build --target web --out-dir wasm --out-name tgs_wasm
echo "tgs-wasm built OK"
