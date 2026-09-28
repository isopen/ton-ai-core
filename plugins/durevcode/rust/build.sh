#!/bin/bash
set -e
cd "$(dirname "$0")"
cargo build --release
./../rust/target/release/durev --version
