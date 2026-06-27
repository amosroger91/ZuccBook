#!/usr/bin/env node
// ============================================================
//  build-wasm.mjs — compile the Rust ledger-core crate (wasm/) to a
//  web-targeted WASM package at wasm/pkg, consumed by src/lib/embeddings.ts.
//
//  Runs automatically as the `prebuild` step (and can be run directly via
//  `npm run build:wasm`). It is intentionally NON-FATAL: if the Rust
//  toolchain / wasm-pack isn't available (e.g. a dev machine without Rust,
//  or this repo's Windows box where Smart App Control blocks native cargo
//  builds), it writes a tiny stub package instead and exits 0. The stub's
//  init() rejects, which embeddings.ts catches to fall back to its pure-TS
//  path — so `npm run build` and `npm run dev` always work. CI (Linux) has
//  the toolchain, so production gets the real, fast WASM.
//
//  Skip entirely with SKIP_WASM=1.
// ============================================================
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(repoRoot, "wasm", "pkg");

// A previously-built real package (e.g. produced in Docker on this Windows box,
// where Smart App Control blocks native cargo builds). Never clobber it with a
// stub just because wasm-pack can't run in the current environment.
function haveRealPkg() {
  return existsSync(join(pkgDir, "ledgr_core_bg.wasm"));
}

function writeStub(reason) {
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(pkgDir, { recursive: true });
  const throwing = (name) =>
    `export function ${name}() { throw new Error("ledgr-core wasm stub (not built)"); }`;
  writeFileSync(
    join(pkgDir, "ledgr_core.js"),
    [
      "// AUTO-GENERATED STUB — the Rust/WASM ledgr-core was not built.",
      `// Reason: ${reason}`,
      "// src/lib/embeddings.ts catches the init() rejection and uses its pure-TS fallback.",
      'export default async function init() { throw new Error("ledgr-core wasm stub (not built)"); }',
      throwing("embed"),
      throwing("embed_many"),
      throwing("cosine"),
      throwing("top_terms"),
      "",
    ].join("\n"),
  );
  // Types so `tsc --noEmit` resolves the import even when only the stub exists.
  writeFileSync(
    join(pkgDir, "ledgr_core.d.ts"),
    [
      "export default function init(): Promise<unknown>;",
      "export function embed(text: string): Float64Array;",
      "export function embed_many(joined: string): Float64Array;",
      "export function cosine(a: Float64Array, b: Float64Array): number;",
      "export function top_terms(text: string, n: number): string[];",
      "",
    ].join("\n"),
  );
  console.warn(`[build-wasm] wrote stub package (${reason}); using TS fallback at runtime.`);
}

if (process.env.SKIP_WASM === "1") {
  if (haveRealPkg()) { console.log("[build-wasm] SKIP_WASM=1 but a real wasm/pkg exists; keeping it."); process.exit(0); }
  writeStub("SKIP_WASM=1");
  process.exit(0);
}

// wasm-pack build wasm --target web --out-dir pkg --release
const run = spawnSync(
  "wasm-pack",
  ["build", "wasm", "--target", "web", "--out-dir", "pkg", "--release"],
  { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
);

if (run.status === 0) {
  console.log("[build-wasm] built wasm/pkg via wasm-pack.");
  process.exit(0);
}

const why = run.error ? `wasm-pack not runnable: ${run.error.message}` : `wasm-pack exited ${run.status}`;
if (haveRealPkg()) {
  console.warn(`[build-wasm] ${why}; keeping the existing real wasm/pkg.`);
} else {
  writeStub(why);
}
process.exit(0); // never block the JS build
