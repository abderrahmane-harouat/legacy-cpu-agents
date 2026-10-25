#!/usr/bin/env bash
# Install opencode, Cline CLI and Bun built for old x86-64 CPUs (Core 2, Pentium Dual-Core, Celeron, Athlon 64 X2,
# Phenom II, ...), and make the Antigravity CLI usable on them.
#
#   curl -fsSL https://raw.githubusercontent.com/abderrahmane-harouat/legacy-cpu-agents/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- opencode cline      # only some of: bun opencode cline agy
#
# Installs into ~/.local/bin (override with LEGACY_BIN_DIR). Debian/Ubuntu/Mint x86_64, glibc 2.17+.
set -euo pipefail

REPO=abderrahmane-harouat/legacy-cpu-agents
BIN=${LEGACY_BIN_DIR:-$HOME/.local/bin}
SHARE=${LEGACY_SHARE_DIR:-$HOME/.local/share/legacy-cpu-agents}
tools=("$@")
[ ${#tools[@]} -gt 0 ] || tools=(bun opencode cline agy)

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "this installer is for Linux"
[ "$(uname -m)" = x86_64 ] || die "needs a 64-bit x86 CPU and a 64-bit (amd64) Linux; found $(uname -m)"
command -v curl >/dev/null || die "install curl first: sudo apt-get install -y curl"
command -v tar >/dev/null || die "install tar first"

flags=$(grep -m1 '^flags' /proc/cpuinfo || true)
model=$(grep -m1 '^model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//' || true)
missing=""
for f in ssse3 sse4_1 sse4_2 popcnt avx avx2; do grep -qw "$f" <<<"$flags" || missing="$missing $f"; done
say "CPU: ${model:-unknown}"
say "CPU lacks:${missing:- nothing relevant (the official builds would work here too)}"
grep -qw cx16 <<<"$flags" || warn "this CPU has no CMPXCHG16B; the legacy builds need it (every Core 2 / Athlon 64 X2 has it)"

mkdir -p "$BIN" "$SHARE"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Newest release whose tag starts with $1 (the API lists releases newest first).
latest_tag() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100" |
    grep -o "\"tag_name\": *\"$1[^\"]*\"" | head -1 | cut -d'"' -f4
}

# fetch <tag> <asset> <sums asset>: download into $tmp and check its sha256 against the release's sums file.
fetch() {
  local base="https://github.com/$REPO/releases/download/$1"
  curl -fL --retry 3 --progress-bar -o "$tmp/$2" "$base/$2"
  if curl -fsSL -o "$tmp/$3" "$base/$3" 2>/dev/null; then
    (cd "$tmp" && grep " $2\$" "$3" | sha256sum -c --quiet -) || die "checksum mismatch for $2"
  fi
}

install_bun() {
  local tag; tag=$(latest_tag bun-v) || true
  [ -n "$tag" ] || die "no legacy bun release found in $REPO"
  say "bun ($tag)"
  fetch "$tag" bun-linux-x64-legacy.tgz SHA256SUMS
  tar -xzf "$tmp/bun-linux-x64-legacy.tgz" -C "$tmp"
  install -m755 "$tmp/package/bin/bun" "$BIN/bun"
  ln -sf bun "$BIN/bunx"
  "$BIN/bun" --version
}

install_opencode() {
  local tag; tag=$(latest_tag opencode-v) || true
  [ -n "$tag" ] || die "no legacy opencode release found in $REPO"
  say "opencode ($tag)"
  fetch "$tag" opencode-linux-x64-legacy.tar.gz opencode-SHA256SUMS
  tar -xzf "$tmp/opencode-linux-x64-legacy.tar.gz" -C "$tmp"
  install -m755 "$tmp/opencode" "$BIN/opencode"
  # `opencode upgrade` would fetch the official build (SSE4.2/AVX2): keep its update check quiet.
  "$BIN/opencode" --version
}

install_cline() {
  local tag; tag=$(latest_tag cline-v) || true
  [ -n "$tag" ] || die "no legacy cline release found in $REPO"
  say "cline ($tag)"
  fetch "$tag" cline-linux-x64-legacy.tar.gz cline-SHA256SUMS
  rm -rf "$SHARE/cline" && mkdir -p "$SHARE/cline"
  tar -xzf "$tmp/cline-linux-x64-legacy.tar.gz" -C "$SHARE/cline"
  ln -sf "$SHARE/cline/cli-linux-x64/bin/cline" "$BIN/cline"
  "$BIN/cline" --version
}

# Antigravity CLI is closed source, so it cannot be rebuilt. If the official binary runs here, use it directly;
# if it dies with an illegal instruction (it needs SSE4.1/SSE4.2/POPCNT), run it through QEMU's user-mode
# emulator, which provides those instructions in software. The binary itself is the official, unmodified one.
install_agy() {
  local ver dir=$SHARE/agy
  ver=$(curl -fsSL "https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest" |
    grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ver" ] || die "could not find the latest Antigravity CLI release"
  say "Antigravity CLI ($ver, official build)"
  curl -fL --retry 3 --progress-bar -o "$tmp/agy.tar.gz" \
    "https://github.com/google-antigravity/antigravity-cli/releases/download/$ver/agy_cli_linux_x64.tar.gz"
  rm -rf "$dir" && mkdir -p "$dir"
  tar -xzf "$tmp/agy.tar.gz" -C "$dir"
  [ -x "$dir/antigravity" ] || die "unexpected Antigravity archive layout"
  [ -e "$BIN/agy" ] && [ ! -e "$BIN/agy.official-backup" ] && mv "$BIN/agy" "$BIN/agy.official-backup"

  local rc=0
  "$dir/antigravity" --version >/dev/null 2>&1 || rc=$?
  if [ $rc -eq 0 ]; then
    ln -sf "$dir/antigravity" "$BIN/agy"
    say "agy runs natively on this CPU"
  else
    say "agy needs instructions this CPU lacks (exit $rc); running it through QEMU user-mode emulation"
    if ! command -v qemu-x86_64 >/dev/null; then
      say "installing qemu-user (needs sudo)"
      sudo apt-get update && sudo apt-get install -y qemu-user || die "could not install qemu-user"
    fi
    cat >"$BIN/agy" <<EOF
#!/bin/sh
# Antigravity CLI through QEMU: the official binary needs SSE4.1/SSE4.2/POPCNT, which this CPU lacks.
exec qemu-x86_64 -cpu max "$dir/antigravity" "\$@"
EOF
    chmod +x "$BIN/agy"
    "$BIN/agy" --version || die "agy did not start even under QEMU; please open an issue at https://github.com/$REPO"
  fi
}

for t in "${tools[@]}"; do
  case "$t" in
    bun) install_bun ;;
    opencode) install_opencode ;;
    cline) install_cline ;;
    agy | antigravity) install_agy ;;
    *) die "unknown tool '$t' (choose from: bun opencode cline agy)" ;;
  esac
done

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN is not on your PATH. Add this to ~/.bashrc:  export PATH=\"$BIN:\$PATH\"" ;;
esac
for t in opencode cline bun; do
  p=$(command -v "$t" 2>/dev/null || true)
  if [ -n "$p" ] && [ "$p" != "$BIN/$t" ]; then
    warn "'$t' on your PATH is $p (probably the official npm build that crashes); remove it with: npm uninstall -g ${t/opencode/opencode-ai}"
  fi
done
say "done"
