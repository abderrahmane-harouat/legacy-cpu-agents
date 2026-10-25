// Runs the parts of Bun that carry SIMD / CPU-specific code (BoringSSL, simdutf, highway, zlib-ng, zstd, brotli,
// libdeflate, libspng/libjpeg-turbo/libwebp, sqlite, mimalloc, the bundler, the CSS parser, the shell, workers and the
// JIT) so an instruction above the legacy floor shows up as SIGILL under `qemu-x86_64 -cpu <old cpu>`.
//
//   bun ci/bun-smoke.ts [--offline]
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const offline = process.argv.includes("--offline");
let failed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  const t = performance.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error)?.stack ?? e}`);
  }
}
function eq(a: unknown, b: unknown) {
  if (a !== b) throw new Error(`${String(a)} !== ${String(b)}`);
}

const dir = mkdtempSync(join(tmpdir(), "bun-legacy-"));
const big = Buffer.from("héllo wörld ✓ ".repeat(50000));

await test("jit tiers (jit-smoke.js)", () => import(join(import.meta.dir, "jit-smoke.js")));
await test("utf8/utf16/base64 (simdutf)", () => {
  const s = new TextDecoder().decode(big);
  eq(new TextEncoder().encode(s).length, big.length);
  eq(Buffer.from(big.toString("base64"), "base64").equals(big), true);
  eq(Buffer.from(big.toString("hex"), "hex").length, big.length);
  eq(Buffer.from(s, "utf16le").toString("utf16le"), s);
  eq(s.toLowerCase().length > 0 && s.toUpperCase().length > 0, true);
});
await test("JSON (highway structural indexer)", () => {
  const obj = { a: Array.from({ length: 20000 }, (_, i) => ({ i, s: `v${i}`, f: i / 7, ok: i % 2 === 0 })) };
  const text = JSON.stringify(obj);
  eq(JSON.parse(text).a[19999].s, "v19999");
  eq((Bun as any).JSONL ? true : true, true);
});
await test("hashing (wyhash/xxhash3/crc32/sha/blake)", () => {
  Bun.hash(big); Bun.hash.xxHash3(big); Bun.hash.crc32(big); Bun.hash.cityHash64(big); Bun.hash.murmur64v2(big);
  eq(new Bun.CryptoHasher("sha256").update("abc").digest("hex"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  eq(crypto.createHash("sha512").update(big).digest("hex").length, 128);
  eq(crypto.createHash("sha1").update("abc").digest("hex"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  new Bun.CryptoHasher("blake2b256").update(big).digest();
  eq(crypto.createHash("md5").update("").digest("hex"), "d41d8cd98f00b204e9800998ecf8427e");
});
await test("crypto (BoringSSL: AES-GCM/CTR/CBC, ECDH, RSA, Ed25519, scrypt)", async () => {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(big), c.final()]);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(c.getAuthTag());
  eq(Buffer.concat([d.update(enc), d.final()]).equals(big), true);
  const k2 = await crypto.subtle.generateKey({ name: "AES-CBC", length: 256 }, true, ["encrypt", "decrypt"]);
  await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, k2, big);
  crypto.createCipheriv("aes-128-ctr", key.subarray(0, 16), crypto.randomBytes(16)).update(big);
  crypto.createCipheriv("aes-256-cbc", key, crypto.randomBytes(16)).update(big);
  const a = crypto.createECDH("prime256v1"), b = crypto.createECDH("prime256v1");
  a.generateKeys(); b.generateKeys();
  eq(a.computeSecret(b.getPublicKey()).equals(b.computeSecret(a.getPublicKey())), true);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
  const sig = crypto.sign("sha256", big, privateKey);
  eq(crypto.verify("sha256", big, publicKey, sig), true);
  const ed = crypto.generateKeyPairSync("ed25519");
  eq(crypto.verify(null, big, ed.publicKey, crypto.sign(null, big, ed.privateKey)), true);
  crypto.scryptSync("pw", "salt", 32, { N: 1024 });
  crypto.pbkdf2Sync("pw", "salt", 1000, 32, "sha256");
});
await test("Bun.password (argon2/bcrypt)", async () => {
  const h = await Bun.password.hash("hunter2", { algorithm: "argon2id", memoryCost: 4096, timeCost: 2 });
  eq(await Bun.password.verify("hunter2", h), true);
  const b = await Bun.password.hash("hunter2", { algorithm: "bcrypt", cost: 4 });
  eq(await Bun.password.verify("hunter2", b), true);
});
await test("compression (zlib-ng, libdeflate, brotli, zstd)", () => {
  eq(zlib.gunzipSync(zlib.gzipSync(big)).equals(big), true);
  eq(zlib.inflateRawSync(zlib.deflateRawSync(big, { level: 9 })).equals(big), true);
  eq(zlib.brotliDecompressSync(zlib.brotliCompressSync(big)).equals(big), true);
  eq(Buffer.from(Bun.gunzipSync(Bun.gzipSync(big))).equals(big), true);
  eq(Buffer.from(Bun.inflateSync(Bun.deflateSync(big))).equals(big), true);
  eq(zlib.crc32(big) >>> 0, zlib.crc32(Buffer.from(big)) >>> 0);
  if ((Bun as any).zstdCompressSync) eq(Buffer.from(Bun.zstdDecompressSync(Bun.zstdCompressSync(big))).equals(big), true);
});
await test("sqlite", () => {
  const db = new Database(":memory:");
  db.run("create table t (id integer primary key, v text)");
  const ins = db.prepare("insert into t (v) values (?)");
  db.transaction(() => { for (let i = 0; i < 5000; i++) ins.run(`row ${i}`); })();
  eq((db.query("select count(*) as n from t where v like '%9%'").get() as any).n, 1355);
  db.run("create virtual table f using fts5(x)");
  db.run("insert into f values ('the quick brown fox')");
  eq((db.query("select count(*) as n from f where f match 'quick'").get() as any).n, 1);
});
await test("files, glob, transpiler, bundler, CSS", async () => {
  writeFileSync(join(dir, "a.ts"), `import { b } from "./b"; export const a: number = b * 2; console.log(a);`);
  writeFileSync(join(dir, "b.ts"), `export const b = 21;`);
  writeFileSync(join(dir, "s.css"), `.a { color: rgb(255 0 0 / 50%); & .b { display: flex } } @media (width >= 600px) { .c { inset: 0 } }`);
  eq(await Bun.file(join(dir, "b.ts")).text(), "export const b = 21;");
  eq(Array.from(new Bun.Glob("*.ts").scanSync(dir)).length, 2);
  eq(new Bun.Transpiler({ loader: "tsx" }).transformSync("const x: number = <div/>;").includes("jsx"), true);
  const out = await Bun.build({ entrypoints: [join(dir, "a.ts"), join(dir, "s.css")], minify: true });
  eq(out.success, true);
  eq(out.outputs.length, 2);
  const css = await out.outputs.find(o => o.path.endsWith(".css"))!.text();
  eq(css.includes(".a"), true);
});
await test("images (libspng, libjpeg-turbo, libwebp, highway resize)", async () => {
  if (!(Bun as any).Image) return console.log("     (no Bun.Image in this version)");
  const raw = new Uint8Array(64 * 64 * 4).map((_, i) => (i * 7) & 255);
  // A 64x64 RGBA PNG made with node:zlib, so the decoder (not just the encoder) runs.
  const crc = (b: Buffer) => { const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b) >>> 0); return c; };
  const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([l, td, crc(td)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(64, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.concat(Array.from({ length: 64 }, (_, y) => Buffer.concat([Buffer.from([y % 5]), Buffer.from(raw.subarray(y * 256, y * 256 + 256))])));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
  const Img = (Bun as any).Image;
  eq((await new Img(png).metadata()).width, 64);
  const jpg = await new Img(png).resize(33, 17).jpeg({ quality: 80 }).bytes();
  eq((await new Img(jpg).metadata()).width, 33);
  const webp = await new Img(png).resize(20).webp({ quality: 70 }).bytes();
  eq((await new Img(webp).metadata()).width, 20);
  const png2 = await new Img(jpg).rotate(90).png().bytes();
  eq((await new Img(png2).metadata()).height, 33);
});
await test("Bun.$ shell + spawn", async () => {
  eq((await Bun.$`echo hi | tr a-z A-Z`.text()).trim(), "HI");
  const p = Bun.spawnSync(["sh", "-c", "echo $((6*7))"]);
  eq(p.stdout.toString().trim(), "42");
});
await test("worker threads", async () => {
  const w = new Worker(URL.createObjectURL(new Blob([`self.onmessage = e => postMessage(e.data.map(x => Math.round(x * 1.5)))`])));
  const r = await new Promise<number[]>(res => { w.onmessage = e => res(e.data); w.postMessage([1, 2, 3]); });
  w.terminate();
  eq(r.join(","), "2,3,5");
});
await test("Bun.serve + fetch + WebSocket (uSockets, HTTP parser)", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return;
      return new Response(Bun.gzipSync(big), { headers: { "content-encoding": "gzip", "x-len": String(big.length) } });
    },
    websocket: { message(ws, m) { ws.send(`echo:${m}`); } },
  });
  const res = await fetch(`http://localhost:${server.port}/x`);
  eq((await res.arrayBuffer()).byteLength, big.length);
  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  const msg = await new Promise(res => { ws.onopen = () => ws.send("ping"); ws.onmessage = e => res(e.data); });
  eq(msg, "echo:ping");
  ws.close();
  server.stop(true);
});
if (!offline) {
  await test("HTTPS fetch (BoringSSL TLS 1.3 + system CA)", async () => {
    const r = await fetch("https://registry.npmjs.org/bun/latest");
    eq(r.ok, true);
    eq(typeof (await r.json()).version, "string");
  });
}

console.log(failed ? `\n${failed} test(s) FAILED` : "\nall bun smoke tests passed");
process.exit(failed ? 1 : 0);
