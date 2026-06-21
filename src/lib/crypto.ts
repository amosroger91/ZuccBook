// ============================================================
//  crypto.ts — identity & signatures via the Web Crypto API.
//  ECDSA P-256. The public key (base64url SPKI) IS the user id.
//  No passwords, no server: the private key lives only on-device.
// ============================================================
import type { Signed } from "@/types";

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const enc = new TextEncoder();

/* ---------- base64url ---------- */
export function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Stable JSON so the same object always signs/verifies identically. */
export function canonical(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((obj as any)[k])).join(",") + "}";
}

export interface KeyMaterial {
  publicKey: string;            // base64url SPKI
  privateKeyJwk: JsonWebKey;
}

export async function generateKeyMaterial(): Promise<KeyMaterial> {
  const pair = await crypto.subtle.generateKey(ALGO, true, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: bufToB64url(spki), privateKeyJwk: jwk };
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ALGO, false, ["sign"]);
}
async function importPublic(pk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", b64urlToBuf(pk), ALGO, false, ["verify"]);
}

/** Wrap any payload in a verifiable signature envelope. */
export async function signRecord<T>(data: T, pk: string, jwk: JsonWebKey): Promise<Signed<T>> {
  const key = await importPrivate(jwk);
  const sig = await crypto.subtle.sign(SIGN, key, enc.encode(canonical(data)));
  return { data, sig: bufToB64url(sig), pk, v: 1 };
}

/** Verify a signature envelope against its embedded public key. */
export async function verifyRecord<T>(rec: Signed<T>): Promise<boolean> {
  try {
    const key = await importPublic(rec.pk);
    return await crypto.subtle.verify(SIGN, key, b64urlToBuf(rec.sig), enc.encode(canonical(rec.data)));
  } catch {
    return false;
  }
}

/** Short, human-friendly fingerprint of a public key. */
export function fingerprint(pk: string): string {
  return pk.slice(0, 6).toUpperCase() + "·" + pk.slice(-4).toUpperCase();
}
