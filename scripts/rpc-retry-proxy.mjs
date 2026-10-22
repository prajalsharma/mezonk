#!/usr/bin/env node
// Local JSON-RPC proxy for Mezo Testnet. The public endpoint load-balances over a node that can lag far behind.
// Answers from it are retried until a node at the head responds:
//   - errors about heights "in the future" (state queries past the lagging node's head),
//   - eth_blockNumber answers well behind the highest head seen,
//   - null blocks / receipts from eth_getBlockByNumber / eth_getTransactionReceipt for recent blocks.
// Usage: node scripts/rpc-retry-proxy.mjs [upstream] [port]. Local development only.
import http from "node:http";

const UP = process.argv[2] ?? "https://rpc.test.mezo.org";
const PORT = Number(process.argv[3] ?? 8600);
const LAG = 50n; // blocks behind the best head we've seen before an answer counts as stale
let head = 0n;

const laggingError = (t) => /height in the future|must be less than or equal to the current blockchain height|invalid height/i.test(t);

/** True if this single response came from a node behind the head. */
function stale(req, res) {
  if (!res || typeof res !== "object") return false;
  if (res.error) return laggingError(JSON.stringify(res.error));
  const m = req?.method;
  if (m === "eth_blockNumber" && typeof res.result === "string") {
    const n = BigInt(res.result);
    if (n > head) head = n;
    return n + LAG < head;
  }
  if (m === "eth_getBlockByNumber" && res.result === null) {
    const tag = req.params?.[0];
    return typeof tag === "string" && tag.startsWith("0x") ? BigInt(tag) <= head : true;
  }
  if (m === "eth_getBlockByNumber" && res.result?.number) {
    const n = BigInt(res.result.number);
    if (req.params?.[0] === "latest" && n + LAG < head) return true;
    if (n > head) head = n;
  }
  return false;
}

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    let text = "";
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(UP, { method: "POST", headers: { "content-type": "application/json" }, body });
        text = await r.text();
        let out;
        try {
          out = JSON.parse(text);
        } catch {
          break;
        }
        const bad = Array.isArray(out)
          ? out.some((o) => stale(Array.isArray(parsed) ? parsed.find((p) => p.id === o.id) : null, o))
          : stale(parsed, out);
        if (!bad) break;
      } catch (e) {
        text = JSON.stringify({ jsonrpc: "2.0", id: parsed?.id ?? null, error: { code: -32603, message: String(e) } });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(text);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc retry proxy on http://127.0.0.1:${PORT} -> ${UP}`));
