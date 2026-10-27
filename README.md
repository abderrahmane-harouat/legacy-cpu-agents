# legacy-cpu-agents

AI coding agents — **opencode**, **Cline CLI**, **Antigravity CLI** — on old x86-64 PCs: Core 2 Duo/Quad, Pentium
Dual-Core, Celeron, Athlon 64 X2, Phenom II and anything else without SSE4.2/POPCNT/AVX.

## Symptoms this fixes

On an old PC, `opencode`, `cline`, `bun` or `agy` dies right away with one of:

```
Illegal instruction (core dumped)
zsh: illegal hardware instruction  opencode
panic(main thread): Illegal instruction at address 0x...
CPU lacks AVX support, strange crashes may occur
```

Typical CPUs: Intel Core 2 Duo / Core 2 Quad, Pentium Dual-Core (E2xxx/E5xxx/E6xxx), Celeron (E1xxx/E3xxx),
Xeon 5100/5300/5400; AMD Athlon 64 X2, Athlon II, Phenom / Phenom II, Turion 64 X2, Opteron (before Bulldozer).
Check yours with `grep -o -w 'sse4_2\|cx16' /proc/cpuinfo | sort -u`: if `sse4_2` is missing, the official builds
can't run; if `cx16` is there, these can. (The first single-core Athlon 64s and early 64-bit Pentium 4s lack `cx16`.)

## Why the official builds crash (`Illegal instruction (core dumped)`)

opencode and Cline are `bun build --compile` executables: the Bun runtime is inside them. Bun 1.4's only x64 build
is its "baseline", compiled with `-march=nehalem` (2008): SSE4.1, SSE4.2 and POPCNT are assumed everywhere, in Bun's
Rust and C++ code, its dependencies and JavaScriptCore. A Pentium Dual-Core / Core 2 has SSSE3 at most, so the very
first such instruction kills the process. (opencode's `-baseline` npm package even ships the same binary as the
regular one, AVX2 included.)

## What this repo does

Rebuilds the whole stack from upstream sources with one change of CPU floor — `-march=x86-64 -mcx16 -msahf`
(SSE2 + CMPXCHG16B + LAHF/SAHF, the Windows 10 floor) — and nothing assumed above it:

| Workflow | Builds | From |
| --- | --- | --- |
| `1. WebKit` | JavaScriptCore + ICU (Bun's `bun-webkit-linux-amd64`) | oven-sh/WebKit at the commit the Bun release pins, its own Dockerfile and toolchain image, `MARCH_FLAG` changed, plus [two patches](patches/webkit): WebAssembly `floor`/`ceil`/`trunc`/`nearest` used `roundss`/`roundsd` (SSE4.1) without a CPU check in the interpreter (IPInt) and the BBQ/OMG JITs; both now fall back to SSE2 |
| `2. Bun` | `bun` 1.4.x | oven-sh/bun + [`patches/bun`](patches/bun): the CPU floor (C/C++, Rust `target-cpu`/features), libspng's SSE4.1 filter level, the WebKit download URL, and bun's own static ISA verifier lowered to SSE2 |
| `3. Apps` | `opencode`, `cline` | their own release build scripts, run by the legacy bun so `--compile` embeds it; Cline gets [one patch](patches/cline) that disables auto-update to the official AVX build |
| `4. Antigravity` | — | agy is closed source (Go + C++ built for x86-64-v2): it SIGILLs on a Core 2 at its first SSE4.1 `pmulld`. The installer runs the official binary through `qemu-x86_64 -cpu max` when it detects that |

JavaScriptCore's JIT already picks SSE4.1/POPCNT/AVX at run time from CPUID, and SIMD-heavy libraries (simdutf,
highway, BoringSSL, zlib-ng, zstd, libjpeg-turbo) dispatch at run time too, so lowering the compile-time floor is
enough: nothing is slower on a modern CPU except code the compiler would have auto-vectorized.

### How it is verified

Every binary is run under QEMU user-mode emulation of **Conroe** (Core 2 / Pentium Dual-Core), **Opteron_G2**
(Athlon 64 X2) and a bare **SSE2 floor** model; QEMU raises SIGILL for any instruction the model lacks, as real
hardware does. A control run of the official binary on the same model must SIGILL, proving the check bites.

- `ci/jit-smoke.js` drives JSC through LLInt → Baseline → DFG → FTL on rounding/clz/typed-array/string/BigInt/wasm
  code, plus Intl (ICU).
- `ci/bun-smoke.ts` covers BoringSSL (AES-GCM, RSA, ECDH, Ed25519, TLS fetch), simdutf, highway JSON, hashing,
  argon2/bcrypt, zlib/brotli/zstd, sqlite+FTS5, the bundler and CSS parser, Bun.Image codecs, the shell, workers,
  Bun.serve/WebSocket.
- `ci/same-runtime.sh` proves each app embeds the legacy runtime byte-for-byte (`.text`).
- opencode: CLI commands, `serve` HTTP API, and the full TUI in a pseudo-terminal; Cline: CLI, hub, full TUI.

## Install on the old PC

Debian / Ubuntu / Mint, 64-bit (x86_64). Three steps:

**1. Run the installer**

```sh
curl -fsSL https://raw.githubusercontent.com/abderrahmane-harouat/legacy-cpu-agents/main/install.sh | bash
```

That installs all four: `bun`, `opencode`, `cline` and `agy`. For only some of them, list them at the end:

```sh
curl -fsSL https://raw.githubusercontent.com/abderrahmane-harouat/legacy-cpu-agents/main/install.sh | bash -s -- opencode cline
```

**2. Open a new terminal**

The terminal you installed from still remembers the old programs. Close it and open a new one.

**3. Check that the right versions run**

```sh
which -a opencode cline
```

The **first** line for each must be in `~/.local/bin`, for example `/home/you/.local/bin/opencode`. Then run
`opencode` or `cline`.

### Already had opencode or Cline installed?

If you installed the official opencode or Cline before, those copies are still on the PC. They are the ones that
crash with `Illegal instruction (core dumped)`, and they can **shadow** (hide) the new builds: typing `opencode`
runs whichever copy your PATH finds first.

The installer handles this for you:

- it adds a line at the **end** of `~/.bashrc` (and `~/.zshrc` if you have one) that puts `~/.local/bin` first;
- it lists every older copy it finds, each with the exact command that removes it.

Removing the old copies is optional once the new ones come first, but it avoids confusion. The usual places are:

| Old copy came from | Where it lives | Remove with |
| --- | --- | --- |
| npm (`npm i -g opencode-ai` / `npm i -g cline`) | npm's global folder | `npm uninstall -g opencode-ai cline` |
| opencode's own installer (`curl https://opencode.ai/install`) | `~/.opencode/bin` | `rm -rf ~/.opencode`, then delete its `PATH` line in `~/.bashrc` |
| Bun (`bun add -g ...`) | `~/.bun/bin` | `bun remove -g opencode-ai cline` |

If `which -a` still shows the old copy first in a new terminal, run `hash -r` (it clears the shell's memory of
where programs are) or run the installer again.

### Good to know

- **Don't run `opencode upgrade`.** It would replace this build with the official one, which crashes on old CPUs.
  Cline's auto-update is already turned off in this build.
- To update later, just run the installer again: it always fetches the newest builds from this repo.
- **Antigravity (`agy`)** is closed source, so it can't be rebuilt. If it crashes on your CPU, the installer runs
  the official binary through QEMU, which provides the missing instructions in software. It's slower than native,
  and it keeps working after Antigravity updates itself.
- Everything goes into `~/.local/bin` and `~/.local/share/legacy-cpu-agents`; nothing needs `sudo` except
  installing QEMU for `agy`.

## Rebuilding for a new upstream release

Run the workflows in order from the Actions tab with the new versions: `1. WebKit` (Bun version) →
`2. Bun` (Bun version) → `3. Apps` (Bun, opencode and Cline versions).

## License

The scripts, workflows and docs in this repo are [MIT](LICENSE). Each file in [`patches/`](patches) modifies an
upstream project and is under that project's license (WebKit: BSD/LGPL, Bun: MIT, Cline: Apache-2.0), and so are
the binaries the workflows build.
