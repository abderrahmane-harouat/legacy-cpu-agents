#!/usr/bin/env bash
# Build a patched Bun release inside oven-sh/WebKit's ubuntu 20.04 toolchain image (LLVM 23, gcc-13 libstdc++,
# glibc 2.31 — the same floor as Bun's own CI sysroot), linking the legacy-floor WebKit from our release.
#
#   docker run ... <toolchain image> /legacy/ci/build-bun.sh
# env: BUN_SRC (bun checkout), BUN_BOOTSTRAP_VERSION, BUN_WEBKIT_RELEASE_BASE, CCACHE_DIR
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
cd "${BUN_SRC:?}"

sed -i 's|http://azure.archive.ubuntu.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list || true
apt-get update
apt-get install -y --no-install-recommends build-essential ccache golang libtool make nasm perl pkg-config \
  python3 ruby unzip git curl ca-certificates xz-utils jq file autoconf automake
rm -rf /var/lib/apt/lists/*

# Rust: the nightly bun pins. RUSTUP_TOOLCHAIN makes rustup ignore rust-toolchain.toml's 11 cross targets.
channel=$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)
export RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH RUSTUP_TOOLCHAIN=$channel
if ! command -v rustup >/dev/null; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
rustup toolchain install "$channel" --profile minimal -c rust-src -c llvm-tools -t x86_64-unknown-linux-gnu

# A released bun runs the build scripts and codegen (it runs on the CI machine, not on the old CPU).
if ! command -v bun >/dev/null; then
  curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_BOOTSTRAP_VERSION:?}/bun-linux-x64.zip"
  unzip -o -q /tmp/bun.zip -d /tmp/bun && install -m755 /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun
fi
bun --version
clang --version | head -1

# The image points C_INCLUDE_PATH at gcc-13's builtin headers, which shadow clang's own <immintrin.h> (see the
# WebKit step of oven-sh/WebKit's Dockerfile). Bun's build finds its own compilers and flags.
unset C_INCLUDE_PATH CC CXX AR RANLIB LD CFLAGS CXXFLAGS

git config --global --add safe.directory '*'
export CCACHE_DIR=${CCACHE_DIR:-/ccache} CCACHE_MAXSIZE=${CCACHE_MAXSIZE:-6G} CCACHE_COMPRESS=1
ccache -z || true

# --lto=off: links the non-LTO `bun-webkit-linux-amd64` lane and keeps the link within a 16 GB runner.
bun scripts/build.ts --profile=release --lto=off --build-dir=build/release "$@"

ccache -s || true
ls -la build/release/bun build/release/bun-profile
build/release/bun --version
build/release/bun --revision
