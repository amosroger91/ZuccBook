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

/** Embed text into a normalized EMBED_DIM vector (hashed tri-grams + words). */
export function embed(text: string): number[] {
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

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both are already L2-normalized
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

/** Top keywords driving a vector — used for "why recommended" explanations. */
export function topTerms(text: string, n = 4): string[] {
  const counts = new Map<string, number>();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}
