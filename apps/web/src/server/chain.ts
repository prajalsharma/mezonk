import "server-only";
import { createPublicClient, http } from "viem";
import { deployment } from "@/lib/chain/config";

/** Server-side RPC. MEZO_RPC_URL lets the backend use a private provider without exposing it. */
export const publicClient = createPublicClient({
  chain: deployment.chain,
  transport: http(process.env.MEZO_RPC_URL || deployment.rpcUrl, { retryCount: 3, timeout: 20_000 }),
});

let cached: { at: number; ms: number } | null = null;

/**
 * Current chain time in ms (latest block timestamp), cached for 5s. Lifecycle stages are decided
 * by block.timestamp on-chain, so the server labels stages with chain time, not the host clock.
 * Falls back to the host clock only if the RPC is unreachable.
 */
export async function chainNowMs(): Promise<number> {
  if (cached && Date.now() - cached.at < 5_000) return cached.ms + (Date.now() - cached.at);
  try {
    const b = await publicClient.getBlock();
    cached = { at: Date.now(), ms: Number(b.timestamp) * 1000 };
    return cached.ms;
  } catch {
    return Date.now();
  }
}
