#!/usr/bin/env node
// Local JSON-RPC proxy for forking Mezo Testnet. The public endpoint load-balances over a node that can lag far
// behind; anvil's lazy state fetches that land on it fail ("height in the future") and break the fork. This retries
// those answers until a node at the head responds. Local development only.
import http from "node:http";

const UP = process.argv[2] ?? "https://rpc.test.mezo.org";
const PORT = Number(process.argv[3] ?? 8600);
const lagging = (t) => /height in the future|must be less than or equal to the current blockchain height|invalid height/i.test(t);

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    let text = "";
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(UP, { method: "POST", headers: { "content-type": "application/json" }, body });
        text = await r.text();
        if (!lagging(text)) break;
      } catch (e) {
        text = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e) } });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(text);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc retry proxy on http://127.0.0.1:${PORT} -> ${UP}`));
