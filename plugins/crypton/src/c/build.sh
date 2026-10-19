#!/bin/bash
set -e
cd "$(dirname "$0")"

CLANG="${CLANG:-$HOME/.local/llvm21/usr/lib/llvm-21/bin/clang}"
OUT_DIR=wasm
mkdir -p "$OUT_DIR"

"$CLANG" --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter -fno-builtin -nostdlib \
  -Wl,--no-entry -Wl,-z,stack-size=262144 -Wl,--export-memory \
  platform.c aes.c hashes.c bigint.c crypton.c tests/crypton_kat.c wasm_api.c \
  -o "$OUT_DIR/crypton_wasm_bg.wasm"

echo "crypton_wasm_bg.wasm built OK"
