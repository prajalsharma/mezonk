import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GET as cron } from "@/app/api/cron/index/route";
import { POST as evidence } from "@/app/api/market-evidence/route";
import { POST as evidenceDoc } from "@/app/api/evidence-documents/route";
import { GET as markets } from "@/app/api/markets/route";
import { evidenceMessage } from "@/lib/market/evidence";

const req = (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json", ...init?.headers },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

describe("API authorization and validation (no database needed)", () => {
  it("cron indexer rejects missing or wrong secrets", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await cron(req("/api/cron/index"))).status).toBe(401);
    expect((await cron(req("/api/cron/index", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    // With no secret configured the endpoint is closed, not open.
    expect((await cron(req("/api/cron/index", { headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
  });

  it("community evidence requires a valid wallet signature", async () => {
    const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const body = { marketId: 1, url: "https://example.org/a", note: "Source shows the close at 0.0387.", author: acct.address };
    const wrong = await acct.signMessage({ message: evidenceMessage(1, "https://example.org/OTHER", body.note) });
    const r = await evidence(req("/api/market-evidence", { method: "POST", body: { ...body, signature: wrong } }));
    expect(r.status).toBe(401);
    const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const forged = await other.signMessage({ message: evidenceMessage(1, body.url, body.note) });
    expect((await evidence(req("/api/market-evidence", { method: "POST", body: { ...body, signature: forged } }))).status).toBe(401);
  });

  it("rejects unsafe or malformed evidence input", async () => {
    const bad = (await evidence(req("/api/market-evidence", { method: "POST", body: { marketId: 1, url: "javascript:alert(1)", note: "x", author: "0x1", signature: "0x" } }))).status;
    expect(bad).toBe(400);
    const doc = {
      v: 1,
      kind: "proposal",
      marketId: 1,
      summary: "Too short",
      links: [{ url: "http://insecure.example", label: "" }],
      author: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      createdAt: new Date().toISOString(),
    };
    expect((await evidenceDoc(req("/api/evidence-documents", { method: "POST", body: doc }))).status).toBe(400);
    const creds = { ...doc, summary: "A long enough summary of the evidence.", links: [{ url: "https://user:pw@example.org", label: "" }] };
    expect((await evidenceDoc(req("/api/evidence-documents", { method: "POST", body: creds }))).status).toBe(400);
  });

  it("validates list query parameters", async () => {
    const r = await markets(req("/api/markets?sort=DROP%20TABLE&limit=9999"));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe("bad_request");
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts/); // no stack traces
  });
});
