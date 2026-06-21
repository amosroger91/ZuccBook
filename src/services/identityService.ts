// ============================================================
//  identityService — owns the on-device cryptographic identity.
//  Generates a keypair on first launch, signs records, and
//  exports/imports the identity as a portable file (your account
//  is a file you own — move it between devices, no server).
// ============================================================
import type { Identity, SecretIdentity, Signed } from "@/types";
import { generateKeyMaterial, signRecord, verifyRecord, fingerprint } from "@/lib/crypto";
import { storage } from "./storage";
import { bus } from "@/lib/events";

const ADJ = ["Neon", "Quantum", "Lunar", "Vivid", "Cipher", "Echo", "Nova", "Astro", "Pixel", "Hyper", "Zen", "Flux"];
const NOUN = ["Drifter", "Oracle", "Nomad", "Phantom", "Pilot", "Sage", "Vector", "Comet", "Synth", "Raven", "Wolf", "Spark"];
const rnd = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

class IdentityService {
  private me: SecretIdentity | null = null;

  get current(): SecretIdentity | null { return this.me; }
  get pk(): string { return this.me?.publicKey ?? ""; }

  async load(): Promise<SecretIdentity | null> {
    this.me = (await storage.loadIdentity()) ?? null;
    if (this.me) bus.emit("identity:ready", { pk: this.me.publicKey });
    return this.me;
  }

  async create(username?: string): Promise<SecretIdentity> {
    const km = await generateKeyMaterial();
    const me: SecretIdentity = {
      publicKey: km.publicKey,
      privateKeyJwk: km.privateKeyJwk,
      username: username?.trim() || `${rnd(ADJ)}${rnd(NOUN)}`,
      avatar: "",
      bio: "",
      badges: ["founder"],
      reputation: 0,
      createdAt: Date.now(),
    };
    this.me = me;
    await storage.saveIdentity(me);
    bus.emit("identity:ready", { pk: me.publicKey });
    return me;
  }

  async update(patch: Partial<Pick<Identity, "username" | "avatar" | "bio" | "header" | "html" | "location" | "quote" | "website" | "email" | "phone">>) {
    if (!this.me) return;
    this.me = { ...this.me, ...patch };
    await storage.saveIdentity(this.me);
  }

  /** Public (shareable) view of the identity — no private key. */
  publicProfile(): Identity | null {
    if (!this.me) return null;
    const { privateKeyJwk, ...pub } = this.me;
    return pub;
  }

  /** Sign any payload with this identity. */
  async sign<T>(data: T): Promise<Signed<T>> {
    if (!this.me) throw new Error("no identity");
    return signRecord(data, this.me.publicKey, this.me.privateKeyJwk);
  }
  verify = verifyRecord;
  fingerprint = fingerprint;

  /** Export the full identity (incl. private key) as a downloadable file. */
  exportFile() {
    if (!this.me) return;
    const blob = new Blob([JSON.stringify(this.me, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nebula-identity-${this.me.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import an identity file from another device. */
  async importFile(file: File): Promise<SecretIdentity> {
    const text = await file.text();
    const parsed = JSON.parse(text) as SecretIdentity;
    if (!parsed.publicKey || !parsed.privateKeyJwk) throw new Error("Invalid identity file");
    this.me = parsed;
    await storage.saveIdentity(parsed);
    bus.emit("identity:ready", { pk: parsed.publicKey });
    return parsed;
  }

  /** A compact, URL-safe token of the identity (keys + name) for the
   *  "log in on another device" QR / link. Excludes heavy fields (avatar/html);
   *  those re-sync via the public profile. Treat this token as your password —
   *  anyone who has it controls the account. */
  exportToken(): string {
    if (!this.me) return "";
    const { publicKey, privateKeyJwk, username, badges, reputation, createdAt } = this.me;
    return b64urlEncode(JSON.stringify({ publicKey, privateKeyJwk, username, badges, reputation, createdAt }));
  }

  /** Import an identity from a token (the other half of exportToken). */
  async importToken(token: string): Promise<SecretIdentity> {
    const parsed = JSON.parse(b64urlDecode(token)) as Partial<SecretIdentity>;
    if (!parsed.publicKey || !parsed.privateKeyJwk) throw new Error("Invalid login token");
    const me: SecretIdentity = {
      publicKey: parsed.publicKey,
      privateKeyJwk: parsed.privateKeyJwk,
      username: parsed.username || "Friend",
      avatar: parsed.avatar ?? "",
      bio: parsed.bio ?? "",
      badges: parsed.badges ?? [],
      reputation: parsed.reputation ?? 0,
      createdAt: parsed.createdAt ?? Date.now(),
    };
    this.me = me;
    await storage.saveIdentity(me);
    bus.emit("identity:ready", { pk: me.publicKey });
    return me;
  }
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const identityService = new IdentityService();
