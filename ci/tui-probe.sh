#!/usr/bin/env bash
# Start a full-screen TUI in a pseudo-terminal under an emulated old CPU, let it run for a while (rendering through
# OpenTUI's native library, loading tree-sitter, spawning workers), then stop it. Passes if it was still alive when
# stopped, never hit SIGILL, and drew something.
#
#   tui-probe.sh <cpu model> <seconds> <program> [args...]
set -uo pipefail
cpu=$1 secs=$2; shift 2
[ "$cpu" = floor ] && cpu="qemu64,-sse3,-ssse3,-sse4.1,-sse4.2,-popcnt,-abm,-sse4a,-monitor,+cx16,+lahf-lm"
log=$(mktemp)
cmd=$(printf '%q ' "${QEMU:-qemu-x86_64}" -cpu "$cpu" "$@")
# Own session: an app that signals its whole process group on exit must not take this script down with it.
TERM=xterm-256color COLUMNS=120 LINES=40 setsid --wait timeout --signal=TERM --kill-after=20 "$secs" \
  script -qefc "stty cols 120 rows 40; exec $cmd" /dev/null >"$log" 2>&1 </dev/zero
rc=$?
bytes=$(wc -c <"$log")
echo "[$1] exit $rc after ${secs}s, $bytes bytes of terminal output"
tr -d '\033' <"$log" | sed 's/\[[0-9;?]*[a-zA-Z]//g' | tr -s ' \n' | tail -c 1500
echo
if grep -qE 'Illegal instruction|SIGILL|panic\(' "$log"; then echo "::error::TUI crashed (SIGILL/panic)"; exit 1; fi
# 124 = still running when timeout stopped it: what a TUI waiting for input should be doing.
if [ $rc -ne 124 ] && [ $rc -ne 0 ]; then echo "::error::TUI exited early with $rc"; exit 1; fi
if [ "$bytes" -lt 200 ]; then echo "::error::TUI drew almost nothing"; exit 1; fi
rm -f "$log"
