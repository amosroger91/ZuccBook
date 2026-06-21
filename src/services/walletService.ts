// ============================================================
//  walletService — a self-custody Polygon wallet, browser-only.
//  Generates an EVM keypair on first use (your keys, like your
//  identity), stored locally; talks to Polygon through a public RPC
//  via ethers.js. No backend, no custody by us. Supports native MATIC
//  (gas/money) and USDC (a stablecoin = real "money"). It's a hot
//  burner wallet — keep only small amounts and export your key.
// ============================================================
import { JsonRpcProvider, Wallet, Contract, formatEther, parseEther, formatUnits, parseUnits, isAddress } from "ethers";
import { storage } from "./storage";

// Keyless, CORS-enabled public Polygon RPCs (verified to work from a browser),
// tried in order with failover. (polygon-rpc.com now 401s; llamarpc/ankr lack
// browser CORS or need a key — omitted.)
const RPCS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://1rpc.io/matic",
  "https://polygon.drpc.org",
];
export const CHAIN = { id: 137, name: "Polygon", explorer: "https://polygonscan.com" };
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359"; // native USDC on Polygon (6 decimals)
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

let provider: JsonRpcProvider | null = null;
let pkCache: string | null = null;

async function loadPk(): Promise<string> {
  if (pkCache) return pkCache;
  let pk = await storage.kvGet<string>("wallet:pk");
  if (!pk) { pk = Wallet.createRandom().privateKey; await storage.kvSet("wallet:pk", pk); }
  pkCache = pk;
  return pk;
}

// Find a reachable RPC (probes each; first that answers wins). `force` re-probes.
async function getProvider(force = false): Promise<JsonRpcProvider> {
  if (provider && !force) return provider;
  let lastErr: unknown;
  for (const url of RPCS) {
    try {
      const p = new JsonRpcProvider(url, CHAIN.id, { staticNetwork: true });
      await p.getBlockNumber();          // probe (also confirms CORS works)
      provider = p;
      return p;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("No reachable Polygon RPC");
}

async function signer(): Promise<Wallet> {
  return new Wallet(await loadPk(), await getProvider());
}

export type Currency = "MATIC" | "USDC";

class WalletService {
  isValidAddress = isAddress;
  explorerTx(hash: string) { return `${CHAIN.explorer}/tx/${hash}`; }

  /** Address derives from the key alone — no RPC needed (so it always shows). */
  async address(): Promise<string> { return new Wallet(await loadPk()).address; }

  async balances(): Promise<{ matic: string; usdc: string }> {
    const addr = await this.address();
    const read = async (p: JsonRpcProvider) => {
      const matic = await p.getBalance(addr);
      let usdc = 0n;
      try { usdc = await new Contract(USDC, ERC20, p).balanceOf(addr); } catch {}
      return { matic: Number(formatEther(matic)).toFixed(4), usdc: Number(formatUnits(usdc, 6)).toFixed(2) };
    };
    try { return await read(await getProvider()); }
    catch { return await read(await getProvider(true)); }  // rotate to another RPC and retry
  }

  /** Send MATIC or USDC. Returns the tx hash. Throws on failure. */
  async send(to: string, amount: string, currency: Currency): Promise<string> {
    if (!isAddress(to)) throw new Error("Invalid address");
    const w = await signer();
    if (currency === "USDC") {
      const tx = await new Contract(USDC, ERC20, w).transfer(to, parseUnits(amount, 6));
      return tx.hash;
    }
    const tx = await w.sendTransaction({ to, value: parseEther(amount) });
    return tx.hash;
  }

  async exportKey(): Promise<string> { return new Wallet(await loadPk()).privateKey; }
  async importKey(pk: string): Promise<string> {
    const w = new Wallet(pk.trim());
    await storage.kvSet("wallet:pk", w.privateKey);
    pkCache = w.privateKey;
    return w.address;
  }
}

export const walletService = new WalletService();
