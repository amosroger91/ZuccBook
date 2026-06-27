// ============================================================
//  embeddings.ts — local, dependency-free text embeddings + vector
//  search. This is the engine behind AI-curated feeds and "why was
//  this recommended", and it runs 100% on-device with zero network.
//
//  It uses a hashed character n-gram bag-of-words projected into a
//  fixed-width L2-normalized vector. That's deliberately lightweight
//  and inspectable; the CompanionService can swap in transformer
//  embeddings (WebLLM / transformers.js) behind the same interface
//  (see ROADMAP — embeddings are an interface, not a hard choice).
//
//  PERF: the tight numeric core (embed/embedMany/cosine/topTerms) is
//  also implemented in Rust and compiled to WASM (../../wasm). When
//  the WASM module is loaded (initEmbeddings(), called from boot() and
//  the feed worker) these functions transparently dispatch to it; the
//  pure-TS implementation below stays as the canonical reference AND
//  the fallback for any context where the WASM hasn't loaded (pre-init
//  calls, load failure, tests, SSR). The WASM is a bit-identical port
//  — same EMBED_DIM, FNV-1a hashing, tokenizer and f64 math — so
//  stored embeddings and feed rankings are unaffected by which path runs.
// ============================================================

export const EMBED_DIM = 256;

const STOP = new Set("the a an and or but of to in on for with at by is are was be it this that you i we they he she".split(" "));

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9#@\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// FNV-1a hash → bucket index
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % EMBED_DIM;
}

// ---- pure-TS reference implementations (also the runtime fallback) ----

function tsEmbed(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  const toks = tokens(text);
  for (const tok of toks) {
    v[hash(tok)] += 1;                        // word feature
    for (let i = 0; i < tok.length - 2; i++)  // char tri-gram features
      v[hash(tok.slice(i, i + 3))] += 0.5;
  }
  // L2 normalize
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function tsCosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both are already L2-normalized
}

function tsTopTerms(text: string, n = 4): string[] {
  const counts = new Map<string, number>();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}

// ---- WASM acceleration (optional, transparent) ----

interface WasmCore {
  embed(text: string): Float64Array;
  embed_many(joined: string): Float64Array;
  cosine(a: Float64Array, b: Float64Array): number;
  top_terms(text: string, n: number): string[];
}

let wasm: WasmCore | null = null;
let initPromise: Promise<void> | null = null;

/** Load the Rust/WASM core once. Idempotent and safe to await from anywhere
 *  (main thread boot + the feed worker). On any failure it silently leaves the
 *  pure-TS path in place, so the app never depends on the WASM being present. */
export function initEmbeddings(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // Built by scripts/build-wasm.mjs into wasm/pkg (real wasm-pack output in
      // CI/Docker, or a throwing stub when the Rust toolchain is unavailable —
      // the stub's init() rejects, which we catch and fall back from).
      const mod: any = await import("../../wasm/pkg/ledgr_core.js");
      await mod.default();
      wasm = mod as WasmCore;
    } catch {
      wasm = null; // keep the TS fallback
    }
  })();
  return initPromise;
}

/** True once the WASM core is active (for diagnostics / benchmarks). */
export function embeddingsBackend(): "wasm" | "ts" { return wasm ? "wasm" : "ts"; }

/** Embed text into a normalized EMBED_DIM vector (hashed tri-grams + words). */
export function embed(text: string): number[] {
  if (wasm) return Array.from(wasm.embed(text));
  return tsEmbed(text);
}

/** Batch-embed many texts at once. With WASM active this is a single boundary
 *  crossing for the whole batch (used by RSS/Nostr refresh); otherwise it maps
 *  the TS path. Returns one number[] per input, in order. */
export function embedMany(texts: string[]): number[][] {
  if (!texts.length) return [];
  if (wasm) {
    // The Rust embed_many() splits on a NUL char (wasm/src/lib.rs) — join with the
    // SAME separator (the \u{0} escape, never a raw NUL byte in source) or the whole
    // batch collapses into one string. NUL never appears in feed text.
    const flat = wasm.embed_many(texts.join("\u{0}"));
    // Trust the batch only if its size matches; otherwise (a degenerate all-empty
    // batch, or any future separator drift) fall back to correct per-item embedding.
    if (flat.length === texts.length * EMBED_DIM) {
      const out: number[][] = new Array(texts.length);
      for (let i = 0; i < texts.length; i++) out[i] = Array.from(flat.subarray(i * EMBED_DIM, i * EMBED_DIM + EMBED_DIM));
      return out;
    }
  }
  return texts.map((t) => embed(t));   // per-item (WASM if active, else TS) — always correct
}

export function cosine(a: number[], b: number[]): number {
  if (wasm) {
    if (!a || !b || a.length !== b.length) return 0;
    return wasm.cosine(a instanceof Float64Array ? a : Float64Array.from(a), b instanceof Float64Array ? b : Float64Array.from(b));
  }
  return tsCosine(a, b);
}

/** Top keywords driving a vector — used for "why recommended" explanations. */
export function topTerms(text: string, n = 4): string[] {
  if (wasm) return wasm.top_terms(text, n);
  return tsTopTerms(text, n);
}

/** A running interest profile: the centroid of things a user engaged with. */
export class InterestProfile {
  private centroid = new Array(EMBED_DIM).fill(0);
  private count = 0;

  learn(vec: number[], weight = 1) {
    for (let i = 0; i < EMBED_DIM; i++) this.centroid[i] += vec[i] * weight;
    this.count += weight;
  }
  vector(): number[] {
    if (this.count === 0) return this.centroid;
    let norm = 0;
    const out = this.centroid.map((x) => x / this.count);
    for (const x of out) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return out.map((x) => x / norm);
  }
  score(vec: number[]): number { return cosine(this.vector(), vec); }
  serialize() { return { centroid: this.centroid, count: this.count }; }
  static from(s: { centroid: number[]; count: number } | undefined): InterestProfile {
    const p = new InterestProfile();
    if (s) { p.centroid = s.centroid; p.count = s.count; }
    return p;
  }
}
