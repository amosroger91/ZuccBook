// ============================================================
//  ZuccBook — core domain types.
//  Everything in the app is one of these shapes. Records that
//  travel between peers are signed (see `Signed<T>`).
// ============================================================

/** A cryptographic identity. The keypair is generated on-device; the
 *  public key IS the user id. No accounts, no email, no server. */
export interface Identity {
  publicKey: string;        // base64url SPKI — the canonical user id
  username: string;
  avatar: string;           // data URL or generated gradient seed
  header?: string;          // profile banner photo (data URL)
  bio: string;
  quote?: string;           // a short tagline/quote
  html?: string;            // MySpace-style custom profile HTML/CSS
  location?: string;        // optional, from the Geolocation API only
  website?: string;
  email?: string;           // optional
  phone?: string;           // optional
  badges: string[];
  reputation: number;
  createdAt: number;
}

/** The public, shareable profile synced to other people via Gun. */
export interface Profile {
  pk: string;
  username: string;
  avatar?: string;
  header?: string;
  bio?: string;
  quote?: string;
  html?: string;
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  badges: string[];
  reputation: number;
  communities: string[];    // names of communities they've joined
  walletAddress?: string;   // Polygon address, so others can pay you
  updatedAt: number;
}

/** A marketplace listing. Buying pays the seller's Polygon address directly. */
export interface Listing {
  id: string;
  seller: string;           // public key
  sellerName: string;
  sellerAddress: string;    // Polygon wallet address to pay
  title: string;
  description?: string;
  image?: string;           // data URL
  currency: "MATIC" | "USDC";
  price: string;            // human amount
  createdAt: number;
  sold?: boolean;
  soldTo?: string;          // buyer pk
}

/** The private half, kept only on this device (never transmitted). */
export interface SecretIdentity extends Identity {
  privateKeyJwk: JsonWebKey; // PKCS#8/JWK private key for signing
}

/** A signature envelope. `data` is the payload, `sig` signs a canonical
 *  JSON of it, `pk` is the author's public key so anyone can verify. */
export interface Signed<T> {
  data: T;
  sig: string;   // base64url ECDSA P-256 signature
  pk: string;    // author public key (base64url)
  v: 1;          // envelope version
}

export type PostKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "poll"
  | "markdown"
  | "ai"
  | "music-session"
  | "game-session";

export interface PollOption { id: string; label: string; votes: string[] /* voter pks */; }

export interface Post {
  id: string;
  author: string;            // public key
  authorName: string;        // denormalized for offline display
  authorAvatar?: string;     // denormalized profile photo (data URL)
  kind: PostKind;
  text?: string;             // text / markdown / caption
  media?: MediaRef[];        // images/audio/video (data URLs or peer refs)
  poll?: { question: string; options: PollOption[]; closesAt?: number };
  community?: string;        // community id, if posted to one
  tags: string[];
  createdAt: number;
  // engagement (locally aggregated; CRDT-merged across relays in Phase 2)
  reactions: Record<string, string[]>;  // emoji -> voter pks
  replyTo?: string;          // parent post id (threads)
  // recommendation metadata, computed locally
  embedding?: number[];
  // provenance: how this record reached us
  source: "self" | "peer" | "relay" | "cache";
}

export interface MediaRef {
  type: "image" | "audio" | "video";
  url: string;        // data URL (small) or peer/relay locator
  mime: string;
  bytes?: number;
  alt?: string;
}

export type FeedAlgorithm =
  | "chronological"
  | "trending"
  | "friends"
  | "ai-curated"
  | "discovery"
  | "community";

/** Why a post surfaced — fully inspectable, no black box. */
export interface RecommendationReason {
  postId: string;
  algorithm: FeedAlgorithm;
  score: number;
  factors: { label: string; weight: number; detail?: string }[];
}

export interface Community {
  id: string;
  name: string;
  description: string;
  icon: string;
  visibility: "public" | "private" | "invite";
  channels: Channel[];
  members: string[];        // public keys
  moderators: string[];
  createdAt: number;
  owner: string;
}

export interface Channel {
  id: string;
  name: string;
  kind: "text" | "voice" | "stage" | "events";
  topic?: string;
}

export type PresenceStatus = "online" | "idle" | "away" | "dnd" | "offline";

export interface RichPresence {
  pk: string;
  username: string;
  avatar?: string;
  status: PresenceStatus;
  activity?: { kind: string; detail: string; since: number }; // "Listening to Jazz FM"
  lastSeen: number;
}

export interface ChatMessage {
  id: string;
  channel: string;          // dm:<pk> | community:<id>:<channel> | group:<id>
  author: string;
  authorName: string;
  authorAvatar?: string;
  text?: string;
  media?: MediaRef[];
  reactions: Record<string, string[]>;
  createdAt: number;
  editedAt?: number;
  deleted?: boolean;
  replyTo?: string;
}

export interface ListenRoom {
  id: string;
  host: string;
  title: string;
  source: { kind: "radio" | "podcast" | "playlist" | "stream"; url: string; title: string };
  startedAt: number;        // epoch when playback position 0 began (for sync)
  positionAt: number;       // host position snapshot
  paused: boolean;
  members: string[];
}

/** Shared YouTube watch-party state. Position is derived: when `playing`,
 *  currentTime = baseTime + (now - refEpoch)/1000; otherwise it's baseTime. */
export interface WatchPartyState {
  videoId: string | null;
  playing: boolean;
  baseTime: number;   // video seconds at the reference moment
  refEpoch: number;   // epoch ms when the video was at baseTime
  by: string;         // who set it (pk)
  byName?: string;    // their display name (so receivers don't need a profile sync)
  title?: string;
}

export type ModerationProfile =
  | "family-friendly"
  | "unfiltered"
  | "academic"
  | "gaming"
  | "discovery";

export interface ModerationVerdict {
  allowed: boolean;
  score: number;            // 0 = clean, 1 = certainly blocked
  labels: string[];         // e.g. ["spam","nsfw"]
  layer: "local-ai" | "community" | "user-filter";
  reason?: string;
}

export interface Badge { id: string; label: string; icon: string; description: string; tier: 1 | 2 | 3; }

export interface ReputationLedgerEntry {
  id: string;
  kind: "helpful" | "expertise" | "participation" | "trust";
  delta: number;
  reason: string;
  at: number;
}

/** Companion personas — every user has a local AI sidekick. */
export type CompanionPersona = "coach" | "comedian" | "critic" | "researcher" | "friend";

export interface CompanionMessage {
  id: string;
  role: "user" | "companion";
  text: string;
  at: number;
}

export interface AppSettings {
  feedAlgorithm: FeedAlgorithm;
  moderationProfile: ModerationProfile;
  companionPersona: CompanionPersona;
  useWebLLM: boolean;            // on-device LLM enabled
  llmOptOut: boolean;           // user explicitly turned the LLM off
  llmModel: string;             // which WebLLM model to load
  presenceStatus: PresenceStatus;
  reducedMotion: boolean;
}
