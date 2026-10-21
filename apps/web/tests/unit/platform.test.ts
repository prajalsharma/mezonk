/**
 * Profiles, sessions, RBAC, media, slugs and comments against a real (in-memory) Postgres via PGlite,
 * through the actual route handlers. The chain is replaced by a scripted publicClient so protocol roles
 * and transaction receipts are deterministic; nothing here talks to a network.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const H = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MARKETS_ADDRESS = "0x00000000000000000000000000000000000000aa";
  process.env.NEXT_PUBLIC_CHAIN_ID = "31611";
  const chain = {
    owner: "0x0000000000000000000000000000000000000001",
    creators: new Set<string>(),
    curators: new Set<string>(),
    receipts: new Map<string, unknown>(),
  };
  return { chain };
});

vi.mock("@/server/chain", () => ({
  chainNowMs: async () => Date.now(),
  publicClient: {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      const a = String(args?.[0] ?? "").toLowerCase();
      if (functionName === "owner") return H.chain.owner;
      if (functionName === "isCreator") return H.chain.creators.has(a);
      if (functionName === "isCurator") return H.chain.curators.has(a);
      if (functionName === "isResolver") return false;
      if (functionName === "config") return [100, 5000, 3600, 0, 0, 0, 0, 0n, 0n, 0n, "0x0000000000000000000000000000000000000002"];
      throw new Error(`unmocked ${functionName}`);
    },
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const r = H.chain.receipts.get(hash.toLowerCase());
      if (!r) throw new Error("receipt not found");
      return r;
    },
    getCode: async () => "0x",
    verifyMessage: async () => false,
  },
}));

import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { getDb, openDb, schema } from "@/server/db/client";
import { issueNonce, createSession, loginMessage, type Site } from "@/server/auth";
import { maybeBootstrapAdmin } from "@/server/admin";
import { ensureSlugs, marketIdForSlug } from "@/server/slugs";
import { invalidateRoles } from "@/server/roles";
import { GET as profileGet, PUT as profilePut } from "@/app/api/profile/route";
import { POST as actionsPost } from "@/app/api/admin/wallets/[address]/actions/route";
import { POST as replacePost } from "@/app/api/admin/wallets/replace/route";
import { POST as roleOpCreate } from "@/app/api/admin/role-ops/route";
import { POST as roleOpAttach } from "@/app/api/admin/role-ops/[id]/route";
import { GET as commentsGet, POST as commentsPost } from "@/app/api/markets/[id]/comments/route";
import { PATCH as commentPatch, DELETE as commentDelete } from "@/app/api/comments/[id]/route";
import { POST as commentModerate } from "@/app/api/comments/[id]/moderate/route";
import { POST as mediaPost } from "@/app/api/media/route";
import { POST as proposalsPost } from "@/app/api/proposals/route";
import { DELETE as logout, GET as sessionGet } from "@/app/api/auth/session/route";
import { createProposal, curatorAction } from "@/server/governance";
import { getRoles } from "@/server/roles";

const SITE: Site = { domain: "localhost:3000", uri: "http://localhost:3000" };
const MARKETS = process.env.NEXT_PUBLIC_MARKETS_ADDRESS!;

interface User {
  acct: PrivateKeyAccount;
  w: string;
  token: string;
}

async function signIn(acct: PrivateKeyAccount): Promise<User> {
  const n = await issueNonce(acct.address, SITE);
  const sig = await acct.signMessage({ message: n.message });
  const s = await createSession(acct.address, n.nonce, n.issuedAt, sig, SITE);
  if (!s || "suspended" in s) throw new Error("sign-in failed");
  await maybeBootstrapAdmin(s.wallet);
  return { acct, w: s.wallet, token: s.token };
}
const newUser = () => signIn(privateKeyToAccount(generatePrivateKey()));

function req(url: string, init: { method?: string; body?: unknown; token?: string; cookie?: string; origin?: string; form?: FormData } = {}) {
  // Distinct client IPs so per-IP limiters don't couple unrelated test cases; per-wallet limits are tested explicitly.
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = `mezonk_session=${init.cookie}`;
  if (init.origin) headers.origin = init.origin;
  if (!init.form) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}
const P = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let marketSeq = 100;
async function insertMarket(question: string): Promise<number> {
  const db = await getDb();
  const id = ++marketSeq;
  const now = new Date();
  await db.insert(schema.markets).values({
    marketId: id, chainId: 31611, contract: MARKETS, creator: H.chain.owner, resolver: H.chain.owner, arbitrator: H.chain.owner,
    metadataRaw: "{}", metadataHash: keccak256(toHex(question)), structured: false, question, category: "other",
    createdAt: now, createdBlock: 1n, createdTx: "0x" + "1".repeat(64), closeTime: new Date(Date.now() + 86_400_000),
    feeBps: 100, protocolFeeShareBps: 5000, proposalWindow: 1, challengeWindow: 1, arbitrationWindow: 1, proposerBond: "0", disputeBond: "0",
    initialLiquidity: "0", initialYesProbBps: 5000, poolYes: "1", poolNo: "1", collateral: "0", priceYes: 0.5, volume: "0", tradeCount: 0,
    traderCount: 0, lastEventBlock: 1n,
  });
  return id;
}

let admin: User;
beforeAll(async () => {
  process.env.MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "mezonk-media-"));
  (globalThis as unknown as { __mezonkDb?: Promise<unknown> }).__mezonkDb = openDb({ memory: true });
  await getDb();
  const adminKey = generatePrivateKey();
  process.env.ADMIN_BOOTSTRAP_WALLET = privateKeyToAccount(adminKey).address;
  admin = await signIn(privateKeyToAccount(adminKey));
}, 60_000);
beforeEach(() => invalidateRoles());

describe("wallet authentication", () => {
  it("rejects a signature from a different wallet and keeps the nonce usable", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const n = await issueNonce(victim.address, SITE);
    const forged = await attacker.signMessage({ message: n.message });
    expect(await createSession(victim.address, n.nonce, n.issuedAt, forged, SITE)).toBeNull();
    const real = await victim.signMessage({ message: n.message });
    expect(await createSession(victim.address, n.nonce, n.issuedAt, real, SITE)).not.toBeNull();
  });
  it("rejects a reused challenge", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const n = await issueNonce(a.address, SITE);
    const sig = await a.signMessage({ message: n.message });
    expect(await createSession(a.address, n.nonce, n.issuedAt, sig, SITE)).not.toBeNull();
    expect(await createSession(a.address, n.nonce, n.issuedAt, sig, SITE)).toBeNull();
  });
  it("rejects an expired challenge", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const nonce = "f".repeat(32);
    const issuedAt = new Date().toISOString();
    await (await getDb()).insert(schema.authNonces).values({ nonce, wallet: a.address.toLowerCase(), expiresAt: new Date(Date.now() - 1000) });
    const sig = await a.signMessage({ message: loginMessage(a.address, nonce, issuedAt, SITE) });
    expect(await createSession(a.address, nonce, issuedAt, sig, SITE)).toBeNull();
  });
  it("cannot authenticate as another address with its own valid signature", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const b = privateKeyToAccount(generatePrivateKey());
    const n = await issueNonce(a.address, SITE);
    const sigB = await b.signMessage({ message: loginMessage(b.address, n.nonce, n.issuedAt, SITE) });
    expect(await createSession(b.address, n.nonce, n.issuedAt, sigB, SITE)).toBeNull(); // nonce belongs to a
  });
  it("logout revokes the session server-side", async () => {
    const u = await newUser();
    expect((await json(await sessionGet(req("/api/auth/session", { token: u.token })))).wallet).toBe(u.w);
    await logout(req("/api/auth/session", { method: "DELETE", token: u.token }));
    expect((await json(await sessionGet(req("/api/auth/session", { token: u.token })))).wallet).toBeNull();
  });
  it("cookie sessions reject cross-site writes (CSRF) but allow same-origin ones", async () => {
    const u = await newUser();
    const body = { username: "csrf_check", displayName: "CSRF" };
    expect((await profilePut(req("/api/profile", { method: "PUT", cookie: u.token, body, origin: "https://evil.example" }))).status).toBe(401);
    expect((await profilePut(req("/api/profile", { method: "PUT", cookie: u.token, body }))).status).toBe(401); // no Origin
    expect((await profilePut(req("/api/profile", { method: "PUT", cookie: u.token, body, origin: "http://localhost:3000" }))).status).toBe(200);
  });
});

describe("profiles", () => {
  it("creates, restores and updates a profile; usernames are unique in the database", async () => {
    const a = await newUser();
    const b = await newUser();
    const r = await profilePut(req("/api/profile", { method: "PUT", token: a.token, body: { username: "Hal_Finney", displayName: "Hal", bio: "Running bitcoin" } }));
    expect(r.status).toBe(200);
    expect((await json(await profileGet(req("/api/profile", { token: a.token })))).profile.username).toBe("hal_finney");
    const dup = await profilePut(req("/api/profile", { method: "PUT", token: b.token, body: { username: "HAL_FINNEY", displayName: "Not Hal" } }));
    expect(dup.status).toBe(409);
    // A new session for the same wallet restores the same profile.
    const again = await signIn(a.acct);
    expect((await json(await profileGet(req("/api/profile", { token: again.token })))).profile.displayName).toBe("Hal");
  });
  it("rejects reserved and impersonating names server-side", async () => {
    const a = await newUser();
    for (const username of ["admin", "mezo_official", "support1"]) {
      expect((await profilePut(req("/api/profile", { method: "PUT", token: a.token, body: { username, displayName: "x y" } }))).status).toBe(422);
    }
  });
  it("cannot write someone else's profile: the wallet comes from the session, not the body", async () => {
    const a = await newUser();
    const b = await newUser();
    await profilePut(req("/api/profile", { method: "PUT", token: a.token, body: { username: "alice_one", displayName: "Alice", wallet: b.w } }));
    expect((await json(await profileGet(req("/api/profile", { token: b.token })))).profile.username).toBeNull();
  });
});

describe("roles and administration", () => {
  it("bootstraps exactly one administrator and never again", async () => {
    expect((await getRoles(admin.w)).admin).toBe(true);
    process.env.ADMIN_BOOTSTRAP_WALLET = (await newUser()).acct.address;
    const later = await signIn(privateKeyToAccount(generatePrivateKey()));
    expect((await getRoles(later.w)).admin).toBe(false);
  });
  it("members and curators cannot grant roles; curators cannot make themselves admin", async () => {
    const member = await newUser();
    const curator = await newUser();
    H.chain.curators.add(curator.w);
    for (const u of [member, curator]) {
      const r = await actionsPost(req(`/api/admin/wallets/${u.w}/actions`, { method: "POST", token: u.token, body: { action: "grant_admin", reason: "please" } }), P({ address: u.w }));
      expect(r.status).toBe(403);
    }
    expect((await getRoles(curator.w)).admin).toBe(false);
  });
  it("records grants and revocations, blocks self-revocation and protects the last admin", async () => {
    const other = await newUser();
    const grant = await actionsPost(req(`/api/admin/wallets/${other.w}/actions`, { method: "POST", token: admin.token, body: { action: "grant_admin", reason: "second operator" } }), P({ address: other.w }));
    expect(grant.status).toBe(200);
    const self = await actionsPost(req(`/api/admin/wallets/${admin.w}/actions`, { method: "POST", token: admin.token, body: { action: "revoke_admin", reason: "oops" } }), P({ address: admin.w }));
    expect(self.status).toBe(409);
    const rev = await actionsPost(req(`/api/admin/wallets/${other.w}/actions`, { method: "POST", token: admin.token, body: { action: "revoke_admin", reason: "rotation done" } }), P({ address: other.w }));
    expect(rev.status).toBe(200);
    const db = await getDb();
    const log = await db.select().from(schema.auditLog);
    expect(log.some((l) => l.action === "role.grant" && l.subjectId === other.w)).toBe(true);
    expect(log.some((l) => l.action === "role.revoke" && l.subjectId === other.w)).toBe(true);
  });
  it("concurrent identical grants produce one active assignment", async () => {
    const t = await newUser();
    const body = { action: "grant_admin", reason: "race test" };
    const rs = await Promise.all([0, 1, 2].map(() => actionsPost(req(`/api/admin/wallets/${t.w}/actions`, { method: "POST", token: admin.token, body }), P({ address: t.w }))));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const db = await getDb();
    const rows = await db.select().from(schema.roleAssignments);
    expect(rows.filter((r) => r.wallet === t.w && !r.revokedAt)).toHaveLength(1);
  });
  it("suspension revokes sessions and every capability immediately", async () => {
    const c = await newUser();
    H.chain.creators.add(c.w);
    expect((await getRoles(c.w)).capabilities).toContain("market:publish");
    await actionsPost(req(`/api/admin/wallets/${c.w}/actions`, { method: "POST", token: admin.token, body: { action: "suspend", reason: "compromised key" } }), P({ address: c.w }));
    expect((await json(await sessionGet(req("/api/auth/session", { token: c.token })))).wallet).toBeNull();
    expect((await getRoles(c.w)).capabilities).toEqual([]);
    expect((await profilePut(req("/api/profile", { method: "PUT", token: c.token, body: { username: "late_one", displayName: "Late" } }))).status).toBe(401);
    // And it cannot sign back in.
    const n = await issueNonce(c.acct.address, SITE);
    const s = await createSession(c.acct.address, n.nonce, n.issuedAt, await c.acct.signMessage({ message: n.message }), SITE);
    expect(s && "suspended" in s).toBe(true);
  });
  it("a creator-curator cannot review their own proposal", async () => {
    const u = await newUser();
    H.chain.curators.add(u.w);
    H.chain.creators.add(u.w);
    const meta = { v: 1, question: "Will block 9,000,000 be produced before 1 Dec 2030?", category: "other", description: "", rules: { yes: "The explorer shows block 9,000,000 before the date.", no: "The explorer shows no such block before the date.", invalid: "The explorer is unavailable for 7 days after.", ambiguity: "" }, source: { name: "Explorer", url: "https://example.org" }, resolvesAt: "2030-12-01T00:00:00.000Z" };
    const p = await createProposal(u.w, { metadata: meta, closeTime: "2030-11-30T00:00:00.000Z", rationale: "Tracks chain progress for everyone on Mezo." });
    await expect(curatorAction(p.id, await getRoles(u.w), { action: "claim", reason: "", internal: false })).rejects.toMatchObject({ code: "self_review" });
  });
});

describe("on-chain role operations are never reported before confirmation", () => {
  it("stays submitted without a receipt, fails on a non-matching receipt, confirms on a matching one", async () => {
    const target = (await newUser()).w;
    const created = await json(await roleOpCreate(req("/api/admin/role-ops", { method: "POST", token: admin.token, body: { fn: "setCurator", target, grant: true, reason: "new curator" } })));
    const op = created.operation;
    expect(op.status).toBe("awaiting_signature");
    expect(op.calldata).toMatch(/^0x/);

    const h1 = keccak256(toHex("pending tx")) as Hex;
    let r = await json(await roleOpAttach(req(`/api/admin/role-ops/${op.id}`, { method: "POST", token: admin.token, body: { txHash: h1 } }), P({ id: op.id })));
    expect(r.operation.status).toBe("submitted");

    // A successful tx that did something else must not confirm this operation.
    H.chain.receipts.set(h1.toLowerCase(), { status: "success", blockNumber: 10n, logs: [] });
    r = await json(await roleOpAttach(req(`/api/admin/role-ops/${op.id}`, { method: "POST", token: admin.token, body: { txHash: h1 } }), P({ id: op.id })));
    expect(r.operation.status).toBe("failed");

    const h2 = keccak256(toHex("real tx")) as Hex;
    const topics = encodeEventTopics({ abi: mezonkMarketsAbi, eventName: "CuratorUpdated", args: { curator: target as Hex } });
    H.chain.receipts.set(h2.toLowerCase(), {
      status: "success",
      blockNumber: 11n,
      logs: [{ address: MARKETS, topics, data: encodeAbiParameters([{ type: "bool" }], [true]), blockNumber: 11n, logIndex: 0, transactionHash: h2, transactionIndex: 0, blockHash: h2, removed: false }],
    });
    H.chain.curators.add(target);
    r = await json(await roleOpAttach(req(`/api/admin/role-ops/${op.id}`, { method: "POST", token: admin.token, body: { txHash: h2 } }), P({ id: op.id })));
    expect(r.operation.status).toBe("confirmed");
    expect((await getRoles(target)).curator).toBe(true);
  });
});

describe("compromised wallet replacement", () => {
  it("suspends the old wallet, revokes its sessions, moves platform roles and queues on-chain changes", async () => {
    const old = await newUser();
    const repl = await newUser();
    H.chain.curators.add(old.w);
    const g = await actionsPost(req(`/api/admin/wallets/${old.w}/actions`, { method: "POST", token: admin.token, body: { action: "grant_admin", reason: "ops rotation" } }), P({ address: old.w }));
    expect(g.status, JSON.stringify(await g.clone().json())).toBe(200);
    const r = await replacePost(req("/api/admin/wallets/replace", { method: "POST", token: admin.token, body: { oldWallet: old.w, newWallet: repl.w, reason: "Seed phrase leaked in a phishing attack" } }));
    expect(r.status).toBe(200);
    const { report } = await json(r);
    expect(report.done.sessionsRevoked).toBeGreaterThan(0);
    expect(report.done.platformRolesMoved).toContain("ADMINISTRATOR");
    expect(report.pending.onChainOperations.map((o: { fn: string; grant: boolean }) => `${o.fn}:${o.grant}`)).toEqual(["setCurator:false", "setCurator:true"]);
    expect((await getRoles(old.w)).suspended).toBe(true);
    expect((await getRoles(repl.w)).admin).toBe(true);
    // Still a curator on-chain until the owner signs: the backend says so instead of pretending otherwise.
    expect((await getRoles(old.w)).curator).toBe(true);
    expect((await getRoles(old.w)).capabilities).toEqual([]);
  });
  it("requires the replacement wallet to have proven control with its own signature", async () => {
    const old = await newUser();
    const never = privateKeyToAccount(generatePrivateKey()).address;
    const r = await replacePost(req("/api/admin/wallets/replace", { method: "POST", token: admin.token, body: { oldWallet: old.w, newWallet: never, reason: "Lost hardware wallet" } }));
    expect(r.status).toBe(409);
  });
});

describe("slugs", () => {
  it("assigns unique slugs, resolves them, and keeps existing ones untouched", async () => {
    const a = await insertMarket("Will Mezo reach 1B TVL by December?");
    const b = await insertMarket("Will Mezo reach 1B TVL by December?");
    await ensureSlugs();
    const sa = await marketIdForSlug("will-mezo-reach-1b-tvl-by-december");
    expect(sa?.id).toBe(a);
    expect((await marketIdForSlug(`will-mezo-reach-1b-tvl-by-december-${b}`))?.id).toBe(b);
    await ensureSlugs(); // idempotent
    const db = await getDb();
    const rows = await db.select().from(schema.marketSlugs);
    expect(rows.filter((r) => r.marketId === a)).toHaveLength(1);
    await expect(db.insert(schema.marketSlugs).values({ slug: "will-mezo-reach-1b-tvl-by-december", marketId: b })).rejects.toThrow();
  });
});

describe("images", () => {
  const upload = (token: string, bytes: Uint8Array, kind = "avatar", type = "image/png") => {
    const f = new FormData();
    f.set("file", new Blob([bytes as BlobPart], { type }), "x.png");
    f.set("kind", kind);
    return mediaPost(req("/api/media", { method: "POST", token, form: f }));
  };
  it("re-encodes a valid image to WebP and stores it", async () => {
    const u = await newUser();
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#ff004d" } }).png().toBuffer();
    const r = await upload(u.token, png);
    expect(r.status).toBe(201);
    const j = await json(r);
    expect(j.url).toMatch(/^\/api\/media\//);
    const db = await getDb();
    const [m] = await db.select().from(schema.media);
    expect(m!.mime).toBe("image/webp");
  });
  it("rejects spoofed types, SVG, oversized files and unauthenticated uploads", async () => {
    const u = await newUser();
    expect((await upload(u.token, new TextEncoder().encode("<svg><script>alert(1)</script></svg>"), "avatar", "image/svg+xml")).status).toBe(415);
    expect((await upload(u.token, new TextEncoder().encode("MZ executable pretending to be a png....."), "avatar", "image/png")).status).toBe(415);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await upload(u.token, big)).status).toBe(413);
    const f = new FormData();
    f.set("file", new Blob([new Uint8Array(20)]), "x.png");
    f.set("kind", "avatar");
    expect((await mediaPost(req("/api/media", { method: "POST", form: f }))).status).toBe(401);
  });
  it("won't attach someone else's upload to a proposal, and writes nothing when it refuses", async () => {
    const owner = await newUser();
    const thief = await newUser();
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } }).png().toBuffer();
    const { id } = await json(await upload(owner.token, png, "cover"));
    const meta = { v: 1, question: "Will the thief attach an image before 1 Jan 2031?", category: "other", description: "", rules: { yes: "The image is attached before the date shown.", no: "The image is not attached before the date.", invalid: "The page is unavailable for seven days.", ambiguity: "" }, source: { name: "Here", url: "https://example.org" }, resolvesAt: "2031-01-01T00:00:00.000Z" };
    const db = await getDb();
    const before = (await db.select().from(schema.marketProposals)).length;
    const r = await proposalsPost(req("/api/proposals", { method: "POST", token: thief.token, body: { metadata: meta, closeTime: "2030-12-31T00:00:00.000Z", rationale: "Testing image ownership rules properly.", coverMediaId: id } }));
    expect(r.status).toBe(422);
    expect((await db.select().from(schema.marketProposals)).length).toBe(before);
  });
});

describe("comments", () => {
  let market: number;
  beforeAll(async () => {
    market = await insertMarket("Will comments work?");
  });
  const post = (token: string | undefined, body: string) => commentsPost(req(`/api/markets/${market}/comments`, { method: "POST", token, body: { body } }), P({ id: String(market) }));

  it("persist, render XSS payloads as text, and reject unauthenticated writes", async () => {
    const u = await newUser();
    expect((await post(undefined, "hello")).status).toBe(401);
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    expect((await post(u.token, payload)).status).toBe(201);
    const list = await json(await commentsGet(req(`/api/markets/${market}/comments`), P({ id: String(market) })));
    expect(list.items[0].body).toBe(payload); // stored and served as a literal string; React renders it as text
    expect(list.items[0].author.wallet.toLowerCase()).toBe(u.w);
  });
  it("only the author edits or deletes; members can't moderate; admins can, with an audit entry", async () => {
    const a = await newUser();
    const b = await newUser();
    const { comment } = await json(await post(a.token, "my take"));
    const id = String(comment.id);
    expect((await commentPatch(req(`/api/comments/${id}`, { method: "PATCH", token: b.token, body: { body: "hijacked" } }), P({ id }))).status).toBe(403);
    expect((await commentDelete(req(`/api/comments/${id}`, { method: "DELETE", token: b.token }), P({ id }))).status).toBe(403);
    expect((await commentModerate(req(`/api/comments/${id}/moderate`, { method: "POST", token: b.token, body: { action: "hide", reason: "spam spam" } }), P({ id }))).status).toBe(403);
    expect((await commentModerate(req(`/api/comments/${id}/moderate`, { method: "POST", token: admin.token, body: { action: "hide", reason: "off-topic promotion" } }), P({ id }))).status).toBe(200);
    const pub = await json(await commentsGet(req(`/api/markets/${market}/comments`), P({ id: String(market) })));
    expect(pub.items.find((c: { id: number }) => c.id === comment.id).body).toBeNull();
    const db = await getDb();
    expect((await db.select().from(schema.auditLog)).some((l) => l.action === "comment.hide")).toBe(true);
    expect((await commentPatch(req(`/api/comments/${id}`, { method: "PATCH", token: a.token, body: { body: "edited" } }), P({ id }))).status).toBe(409);
  });
  it("paginates with a cursor and throttles bursts and duplicates", async () => {
    const m2 = await insertMarket("Will pagination work?");
    const writers = await Promise.all(Array.from({ length: 5 }, () => newUser()));
    for (let i = 0; i < 25; i++) {
      const w = writers[i % 5]!;
      const r = await commentsPost(req(`/api/markets/${m2}/comments`, { method: "POST", token: w.token, body: { body: `comment ${i}` } }), P({ id: String(m2) }));
      expect(r.status).toBe(201);
    }
    const p1 = await json(await commentsGet(req(`/api/markets/${m2}/comments`), P({ id: String(m2) })));
    expect(p1.items).toHaveLength(20);
    const p2 = await json(await commentsGet(req(`/api/markets/${m2}/comments?before=${p1.nextCursor}`), P({ id: String(m2) })));
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const spammer = await newUser();
    const send = (b: string) => commentsPost(req(`/api/markets/${m2}/comments`, { method: "POST", token: spammer.token, body: { body: b } }), P({ id: String(m2) }));
    expect((await send("same")).status).toBe(201);
    expect((await send("same")).status).toBe(409);
    for (let i = 0; i < 5; i++) await send(`burst ${i}`);
    expect((await send("one too many")).status).toBe(429);
  });
  it("refuses comments on markets that don't exist", async () => {
    const u = await newUser();
    const r = await commentsPost(req(`/api/markets/999999/comments`, { method: "POST", token: u.token, body: { body: "hi" } }), P({ id: "999999" }));
    expect(r.status).toBe(404);
  });
});

describe("database guarantees", () => {
  it("the audit log is append-only at the database level", async () => {
    const db = await getDb();
    await expect(db.update(schema.auditLog).set({ action: "tampered" })).rejects.toThrow();
    await expect(db.delete(schema.auditLog)).rejects.toThrow();
  });
});
