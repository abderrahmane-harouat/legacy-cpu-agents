#!/usr/bin/env bash
# Run a command under QEMU user-mode emulation of old x86-64 CPUs. QEMU's TCG raises SIGILL for any instruction
# whose CPUID feature the emulated model lacks, which is exactly what the real hardware does.
#
#   old-cpus.sh [--expect-sigill] <program> [args...]
#
# Models (all lack SSE4.1, SSE4.2, POPCNT, AVX, BMI):
#   Conroe        Core 2 Duo / Pentium Dual-Core / Celeron E (SSE3, SSSE3)
#   Opteron_G2    Athlon 64 X2 / Opteron rev F (SSE3, no SSSE3)
#   floor         the legacy target itself: SSE2 + CMPXCHG16B + LAHF/SAHF, nothing else
set -uo pipefail
expect_sigill=0
if [ "${1:-}" = --expect-sigill ]; then expect_sigill=1; shift; fi
QEMU=${QEMU:-qemu-x86_64}
CPUS=${CPUS:-"Conroe Opteron_G2 floor"}
status=0
for cpu in $CPUS; do
  model=$cpu
  [ "$cpu" = floor ] && model="qemu64,-sse3,-ssse3,-sse4.1,-sse4.2,-popcnt,-abm,-sse4a,-monitor,+cx16,+lahf-lm"
  echo "::group::[$cpu] $*"
  start=$(date +%s)
  log=$(mktemp)
  "$QEMU" -cpu "$model" "$@" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  echo "[$cpu] exit $rc after $(( $(date +%s) - start ))s"
  # 132 = 128 + SIGILL. Bun's crash handler catches SIGILL itself and reports "Illegal instruction".
  sigill=0
  if [ $rc -eq 132 ] || grep -qE 'Illegal instruction|SIGILL' "$log"; then sigill=1; fi
  rm -f "$log"
  if [ $expect_sigill = 1 ]; then
    # The control proves QEMU really enforces the model's CPUID features.
    if [ $sigill = 0 ]; then echo "::error::[$cpu] expected SIGILL from the control binary, got exit $rc"; status=1; fi
  elif [ $rc -ne 0 ] || [ $sigill = 1 ]; then
    [ $sigill = 1 ] && echo "::error::[$cpu] SIGILL: an instruction above this CPU's feature set ran"
    status=1
  fi
done
exit $status
