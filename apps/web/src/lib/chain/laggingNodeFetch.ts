/**
 * fetch for viem's http transport that skips answers from a lagging RPC node.
 * Mezo Testnet's public endpoint load-balances over a node that can sit far behind the chain head; answers from it
 * (old block numbers, missing blocks, "height in the future" errors) are retried until a node at the head responds.
 * Same rules as scripts/rpc-retry-proxy.mjs. Harmless on healthy endpoints: good answers pass straight through.
 */
const LAG = 50n;
const TRIES = 8;
let head = 0n;

type Rpc = { id?: unknown; method?: string; params?: unknown[] };
type Res = { id?: unknown; result?: unknown; error?: unknown };

const laggingError = (t: string) => /height in the future|must be less than or equal to the current blockchain height|invalid height|Oracle is stale/i.test(t);

function stale(req: Rpc | undefined, res: Res): boolean {
  if (res.error) return laggingError(JSON.stringify(res.error));
  const m = req?.method;
  if (m === "eth_blockNumber" && typeof res.result === "string") {
    const n = BigInt(res.result);
    if (n > head) head = n;
    return n + LAG < head;
  }
  if (m === "eth_getBlockByNumber") {
    const tag = req?.params?.[0];
    if (res.result === null) return typeof tag === "string" && tag.startsWith("0x") ? BigInt(tag) <= head : true;
    const num = (res.result as { number?: string } | undefined)?.number;
    if (num) {
      const n = BigInt(num);
      if (tag === "latest" && n + LAG < head) return true;
      if (n > head) head = n;
    }
  }
  return false;
}

export const laggingNodeFetch: typeof fetch = async (input, init) => {
  let parsed: Rpc | Rpc[] | null = null;
  try {
    parsed = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  } catch {
    parsed = null;
  }
  let last: Response | undefined;
  for (let i = 0; i < TRIES; i++) {
    const r = await fetch(input, init);
    if (!r.ok || !parsed) return r;
    const text = await r.text();
    last = new Response(text, { status: r.status, statusText: r.statusText, headers: r.headers });
    let out: Res | Res[];
    try {
      out = JSON.parse(text);
    } catch {
      return last;
    }
    const bad = Array.isArray(out)
      ? out.some((o) => stale(Array.isArray(parsed) ? parsed.find((p) => p.id === o.id) : undefined, o))
      : stale(Array.isArray(parsed) ? undefined : parsed, out);
    if (!bad) return last;
  }
  return last!;
};
