#!/usr/bin/env bash
# Prove a `bun build --compile` output embeds the legacy bun and not an official one downloaded behind our back:
# the executable code (.text) of the compiled app must be byte-identical to the legacy bun's.
#
#   same-runtime.sh <legacy bun> <compiled app>
set -euo pipefail
t=$(mktemp -d)
objcopy -O binary --only-section=.text "$1" "$t/bun.text"
objcopy -O binary --only-section=.text "$2" "$t/app.text"
a=$(sha256sum <"$t/bun.text" | cut -c1-64) b=$(sha256sum <"$t/app.text" | cut -c1-64)
rm -rf "$t"
echo "legacy bun .text $a"
echo "app        .text $b"
[ "$a" = "$b" ] || { echo "::error::$2 does not embed the legacy bun runtime"; exit 1; }
echo "ok: $2 runs on the legacy bun runtime"
