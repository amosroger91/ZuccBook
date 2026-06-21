// ============================================================
//  records.ts — sign & verify the identity-bearing records that
//  travel between peers. This is what actually enforces the pitch:
//  "every record is signed; nobody can forge you."
//
//  Each record already carries the author's public key (the SPKI
//  base64url string that IS their user id). We sign a canonical
//  JSON of the *authored* fields with the matching private key and
//  store the detached signature on `record.sig`. On ingest, every
//  boundary re-derives that canonical payload and verifies it
//  against the embedded public key — a forged or tampered record
//  fails and is dropped before it ever reaches storage or the UI.
//
//  Mutable/derived fields (reactions, poll votes, embeddings, the
//  sold flag, the signature itself) are deliberately excluded from
//  the signed payload so the signature survives the engagement that
//  CRDT-merges across relays after the fact.
// ============================================================
import { canonical, bufToB64url, b64urlToBuf } from "./crypto";
import type { Post, Profile, Listing, TrustEdge } from "@/types";

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const enc = new TextEncoder();

/** Sentinel "authors" that have no keypair (RSS importer, dev changelog,
 *  seeded demo content). They make no impersonatable identity claim, so
 *  they're exempt from signature checks. A real user id is a long SPKI
 *  string and can never collide with these. */
export function isBotAuthor(pk: string | undefined): boolean {
  return !pk || pk === "rss-bot" || pk === "system" || pk.startsWith("demo_");
}

async function importPriv(jwk: JsonWebKey) {
  return crypto.subtle.importKey("jwk", jwk, ALGO, false, ["sign"]);
}
async function importPub(pk: string) {
  return crypto.subtle.importKey("spki", b64urlToBuf(pk), ALGO, false, ["verify"]);
}

async function sign(payload: unknown, jwk: JsonWebKey): Promise<string> {
  const key = await importPriv(jwk);
  const sig = await crypto.subtle.sign(SIGN, key, enc.encode(canonical(payload)));
  return bufToB64url(sig);
}
async function verify(payload: unknown, sig: string, pk: string): Promise<boolean> {
  try {
    const key = await importPub(pk);
    return await crypto.subtle.verify(SIGN, key, b64urlToBuf(sig), enc.encode(canonical(payload)));
  } catch {
    return false;
  }
}

/* ---------------- Post ---------------- */
// Only the immutable authored content. Excludes reactions, poll votes,
// embedding, source and authorAvatar (all mutable/derived/denormalized).
function postPayload(p: Post) {
  return {
    id: p.id,
    author: p.author,
    authorName: p.authorName,
    kind: p.kind,
    text: p.text ?? "",
    html: p.html ?? "",
    media: (p.media ?? []).map((m) => ({ type: m.type, url: m.url, mime: m.mime, alt: m.alt ?? "" })),
    poll: p.poll
      ? { question: p.poll.question, options: p.poll.options.map((o) => ({ id: o.id, label: o.label })), closesAt: p.poll.closesAt ?? null }
      : null,
    community: p.community ?? "",
    tags: [...(p.tags ?? [])].sort(),
    replyTo: p.replyTo ?? "",
    createdAt: p.createdAt,
  };
}
export async function signPost(p: Post, jwk: JsonWebKey): Promise<void> {
  p.sig = await sign(postPayload(p), jwk);
}
/** True if this post genuinely came from the public key it claims (or is a bot). */
export async function postIsAuthentic(p: Post): Promise<boolean> {
  if (isBotAuthor(p.author)) return true;
  if (!p.sig) return false;
  return verify(postPayload(p), p.sig, p.author);
}

/* ---------------- Profile ---------------- */
function profilePayload(p: Profile) {
  const { sig, ...rest } = p as Profile & { sig?: string };
  return rest;
}
export async function signProfile(p: Profile, jwk: JsonWebKey): Promise<void> {
  p.sig = await sign(profilePayload(p), jwk);
}
export async function profileIsAuthentic(p: Profile): Promise<boolean> {
  if (isBotAuthor(p.pk)) return true;
  if (!p.sig) return false;
  return verify(profilePayload(p), p.sig, p.pk);
}

/* ---------------- Trust edge ---------------- */
function trustPayload(e: TrustEdge) {
  return { from: e.from, to: e.to, kind: e.kind, community: e.community ?? "", reason: e.reason ?? "", at: e.at };
}
export async function signTrust(e: TrustEdge, jwk: JsonWebKey): Promise<void> {
  (e as TrustEdge & { sig?: string }).sig = await sign(trustPayload(e), jwk);
}
export async function trustIsAuthentic(e: TrustEdge): Promise<boolean> {
  if (isBotAuthor(e.from)) return true;
  const sig = (e as TrustEdge & { sig?: string }).sig;
  if (!sig) return false;
  return verify(trustPayload(e), sig, e.from);
}

/* ---------------- Marketplace listing ---------------- */
// Signs the seller-authored content incl. the payout address. The `sold`
// flag is set later by the buyer (who can't sign as the seller), so it's
// excluded and treated as advisory — the signature still guarantees the
// seller, price, and Polygon address a buyer pays can't be forged.
function listingPayload(l: Listing) {
  return {
    id: l.id,
    seller: l.seller,
    sellerName: l.sellerName,
    sellerAddress: l.sellerAddress,
    title: l.title,
    description: l.description ?? "",
    image: l.image ?? "",
    currency: l.currency,
    price: l.price,
    createdAt: l.createdAt,
  };
}
export async function signListing(l: Listing, jwk: JsonWebKey): Promise<void> {
  (l as Listing & { sig?: string }).sig = await sign(listingPayload(l), jwk);
}
export async function listingIsAuthentic(l: Listing): Promise<boolean> {
  if (isBotAuthor(l.seller)) return true;
  const sig = (l as Listing & { sig?: string }).sig;
  if (!sig) return false;
  return verify(listingPayload(l), sig, l.seller);
}
