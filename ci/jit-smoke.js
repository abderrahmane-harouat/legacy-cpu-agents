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

// WebAssembly f32/f64 ceil, floor, trunc and nearest: the wasm interpreter (IPInt) implements them with roundss/
// roundsd (SSE4.1) unless it is lowered to SSE2. Compared bit-exactly (Object.is, so -0 counts) with a JS reference.
{
  const ops = [
    ["f32.ceil", 0x8d], ["f32.floor", 0x8e], ["f32.trunc", 0x8f], ["f32.nearest", 0x90],
    ["f64.ceil", 0x9b], ["f64.floor", 0x9c], ["f64.trunc", 0x9d], ["f64.nearest", 0x9e],
  ];
  const str = s => [s.length, ...Array.from(s, c => c.charCodeAt(0))];
  const sec = (id, body) => [id, body.length, ...body];
  const F32 = 0x7d, F64 = 0x7c;
  const types = [2, 0x60, 1, F32, 1, F32, 0x60, 1, F64, 1, F64];
  const funcs = [ops.length, ...ops.map(([n]) => (n.startsWith("f32") ? 0 : 1))];
  const exps = [ops.length, ...ops.flatMap(([n], i) => [...str(n), 0, i])];
  const bodies = [ops.length, ...ops.flatMap(([, op]) => [5, 0, 0x20, 0, op, 0x0b])];
  const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...sec(1, types), ...sec(3, funcs), ...sec(7, exps), ...sec(10, bodies)]);
  const ex = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
  const nearest = x => {
    if (!Number.isFinite(x) || Math.abs(x) >= 2 ** 52) return x;
    const r = Math.round(x); // half up
    const res = r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
    return res === 0 ? (Object.is(x, -0) || x < 0 ? -0 : 0) : res;
  };
  const ref = { ceil: Math.ceil, floor: Math.floor, trunc: Math.trunc, nearest };
  const values = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5, 0.49999999999999994, -0.49999999999999994, 0.7, -0.7,
    1, -1, 123456.789, -123456.789, 2 ** 52 - 0.5, -(2 ** 52 - 0.5), 2 ** 52, 2 ** 52 + 1, 2 ** 53 + 2, 2 ** 62, -(2 ** 62),
    2 ** 63, -(2 ** 63), 2 ** 64, 1e300, -1e300, Number.MAX_VALUE, -Number.MAX_VALUE, 5e-324, -5e-324, 1e-310, -1e-310,
    8388607.5, -8388607.5, 8388608.5, 16777215, 16777217, Infinity, -Infinity, NaN];
  // A few calls only: the interpreter tier must run these, not just the JITs (the warm loop below tiers up).
  const runAll = () => {
    for (const [name] of ops) {
      const f32 = name.startsWith("f32");
      const want = ref[name.split(".")[1]];
      for (const v0 of values) {
        const v = f32 ? Math.fround(v0) : v0;
        const got = ex[name](v);
        const exp = f32 ? Math.fround(want(v)) : want(v);
        if (Number.isNaN(exp) ? !Number.isNaN(got) : !Object.is(got, exp)) {
          failures++;
          log(`FAIL wasm ${name}(${Object.is(v, -0) ? "-0" : v}): got ${Object.is(got, -0) ? "-0" : got}, want ${Object.is(exp, -0) ? "-0" : exp}`);
        }
      }
    }
  };
  runAll();
  for (let i = 0; i < 2000; i++) runAll();
}

if (failures) throw new Error(`${failures} JIT smoke check(s) failed`);
log("jit-smoke: ok");
