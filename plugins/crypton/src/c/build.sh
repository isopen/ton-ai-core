#!/bin/bash
set -e
cd "$(dirname "$0")"

CLANG="${CLANG:-$HOME/.local/llvm21/usr/lib/llvm-21/bin/clang}"
OUT_DIR=wasm
mkdir -p "$OUT_DIR"

"$CLANG" --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter -fno-builtin -nostdlib \
  -Wl,--no-entry -Wl,-z,stack-size=262144 -Wl,--export-memory \
  src/platform.c src/aes.c src/hashes.c src/bigint.c src/crypton.c src/wasm_api.c tests/crypton_kat.c \
  -o "$OUT_DIR/crypton_wasm_bg.wasm"

echo "crypton_wasm_bg.wasm built OK"
