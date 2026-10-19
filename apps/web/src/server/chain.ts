import "server-only";
import { createPublicClient, http } from "viem";
import { deployment } from "@/lib/chain/config";

/** Server-side RPC. MEZO_RPC_URL lets the backend use a private provider without exposing it. */
export const publicClient = createPublicClient({
  chain: deployment.chain,
  transport: http(process.env.MEZO_RPC_URL || deployment.rpcUrl, { retryCount: 3, timeout: 20_000 }),
});
