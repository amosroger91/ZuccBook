// ============================================================
//  marketplaceService — buy & sell items on Polygon. Listings sync
//  via Gun so everyone sees them; buying pays the seller's Polygon
//  address directly (trust-based P2P payment — no escrow/NFT yet).
// ============================================================
import type { Listing } from "@/types";
import { bus } from "@/lib/events";
import { signListing, listingIsAuthentic } from "@/lib/records";
import { identityService } from "./identityService";
import { walletService, type Currency } from "./walletService";
import { newId } from "@/lib/id";

const cache = new Map<string, Listing>();

class MarketplaceService {
  list(): Listing[] { return [...cache.values()].sort((a, b) => b.createdAt - a.createdAt); }

  async ingest(l: Listing) {
    if (!l || !l.id) return;
    const prev = cache.get(l.id);
    // 'sold' is terminal: a buyer marks sold OUTSIDE the signed payload, so the
    // sold copy keeps the seller's original createdAt. A slower peer/Gun relay can
    // re-emit the original unsold copy with the SAME (or older) createdAt — never
    // let it overwrite a listing we already know is sold.
    if (prev?.sold && !l.sold) return;
    if (prev && prev.createdAt > l.createdAt && !l.sold) return;
    // Verify the seller's signature — the listing carries a Polygon payout
    // address a buyer will pay, so a forged listing must never be shown.
    if (!(await listingIsAuthentic(l))) return;
    cache.set(l.id, l);
    bus.emit("market:update", l);
  }

  async create(input: { title: string; description?: string; image?: string; price: string; currency: Listing["currency"] }): Promise<Listing> {
    const me = identityService.current!;
    const listing: Listing = {
      id: newId("mkt"),
      seller: me.publicKey,
      sellerName: me.username,
      sellerAddress: await walletService.address(),
      title: input.title,
      description: input.description,
      image: input.image,
      currency: input.currency,
      price: input.price,
      createdAt: Date.now(),
    };
    await signListing(listing, me.privateKeyJwk);
    cache.set(listing.id, listing);
    bus.emit("market:publish", listing);
    return listing;
  }

  /** Pay the seller on Polygon, then mark the listing sold. Returns tx hash. */
  async buy(listing: Listing): Promise<string> {
    const hash = await walletService.send(listing.sellerAddress, listing.price, listing.currency as Currency);
    // Keep the seller's signed fields (incl. createdAt) intact so their
    // signature still verifies; `sold`/`soldTo` are outside the signed payload.
    const sold: Listing = { ...listing, sold: true, soldTo: identityService.pk };
    cache.set(listing.id, sold);
    bus.emit("market:publish", sold);
    return hash;
  }

  remove(id: string) {
    const l = cache.get(id);
    if (l) { const gone = { ...l, sold: true }; cache.set(id, gone); bus.emit("market:publish", gone); }
  }
}

export const marketplaceService = new MarketplaceService();
