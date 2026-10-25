// Exercises JavaScriptCore's tiers (LLInt -> Baseline -> DFG -> FTL) on code whose fast paths use the SSE4.1 /
// POPCNT / LZCNT / AVX instructions the JIT must not emit on an old CPU: rounding, clz32, float<->int, typed
// arrays, string search, regexps, BigInt, Intl (ICU) and WebAssembly. Runs in the `jsc` shell and in Bun.
const log = typeof print === "function" ? print : console.log;
let failures = 0;
function check(name, got, want) {
  if (got !== want) {
    failures++;
    log(`FAIL ${name}: got ${got}, want ${want}`);
  }
}

function rounding(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = i * 0.37 - 1000.5;
    s += Math.round(x) + Math.floor(x) + Math.ceil(x) + Math.trunc(x) + (Math.fround(x) | 0);
  }
  return s;
}
function bits(n) {
  let s = 0;
  for (let i = 1; i < n; i++) s += Math.clz32(i) + ((i * 2654435761) >>> 27) + (i & -i);
  return s;
}
function typed(n) {
  const f = new Float64Array(1024), u = new Uint8Array(1024), i32 = new Int32Array(1024);
  let s = 0;
  for (let k = 0; k < n; k++) {
    const j = k & 1023;
    f[j] = k / 3; u[j] = k; i32[j] = k * 7;
    s += f[j] + u[j] + i32[j] + Math.sqrt(j) + Math.abs(-j) + Math.max(j, 512) + Math.min(j, 512);
  }
  return Math.round(s);
}
function strings(n) {
  let s = 0;
  const hay = "the quick brown fox jumps over the lazy dog ".repeat(64) + "needle";
  const re = /f(o+)x|n(e+)dle/g;
  for (let i = 0; i < n; i++) {
    s += hay.indexOf("needle") + hay.lastIndexOf("fox") + (hay.includes("lazy") ? 1 : 0);
    s += ("x" + i).padStart(8, "0").length + String.fromCharCode(65 + (i % 26)).charCodeAt(0);
    re.lastIndex = 0;
    s += re.exec(hay).index;
  }
  return s;
}
function bigint(n) {
  let a = 1n;
  for (let i = 1n; i < BigInt(n); i++) a = (a * i + 7n) % 1000000007n;
  return Number(a);
}

// Warm everything through every tier, then compare against the interpreter's own first-run results.
const N = 200000;
const ref = [rounding(1000), bits(1000), typed(1000), strings(50), bigint(300)];
for (let r = 0; r < 30; r++) {
  rounding(N); bits(N); typed(N); strings(2000); bigint(5000);
}
check("rounding", rounding(1000), ref[0]);
check("bits", bits(1000), ref[1]);
check("typed", typed(1000), ref[2]);
check("strings", strings(50), ref[3]);
check("bigint", bigint(300), ref[4]);
check("rounding-value", rounding(10), -49934);
check("clz32", Math.clz32(1), 31);

// Intl goes through ICU, which is built at the same floor.
check("intl", new Intl.NumberFormat("de-DE").format(1234567.891), "1.234.567,891");
check("date", new Date(Date.UTC(2020, 0, 2)).toISOString(), "2020-01-02T00:00:00.000Z");
check("localeCompare", "a".localeCompare("b"), -1);
check("normalize", "é".normalize("NFC"), "é");

// WebAssembly: (func (param i32 i32) (result i32) local.get 0 local.get 1 i32.add) + popcnt.
const wasm = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 3, 2, 0, 0, 7, 13, 2, 3, 97, 100, 100, 0, 0, 3,
  112, 111, 112, 0, 1, 10, 18, 2, 7, 0, 32, 0, 32, 1, 106, 11, 8, 0, 32, 0, 105, 32, 1, 106, 11,
]);
const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm));
let w = 0;
for (let i = 0; i < 300000; i++) w = (w + inst.exports.add(i, 1) + inst.exports.pop(i, 0)) | 0;
check("wasm-add", inst.exports.add(40, 2), 42);
check("wasm-popcnt", inst.exports.pop(0xff, 0), 8);

if (failures) throw new Error(`${failures} JIT smoke check(s) failed`);
log("jit-smoke: ok");
