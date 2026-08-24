#!/bin/bash
set -e
source "$HOME/.cargo/env"
cd "$(dirname "$0")"
wasm-pack build --target web --out-dir ../wasm --out-name crypton_wasm
echo "crypton-wasm built OK"
