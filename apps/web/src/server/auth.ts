import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { deployment } from "@/lib/chain/config";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";

/**
 * Wallet sessions (docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md §5).
 * GET /api/auth/nonce → EIP-4361 message → POST /api/auth/session verifies the signature, consumes the
 * nonce atomically, stores sha256(token) and sets an HttpOnly cookie. Every request re-checks the row,
 * so logout, suspension and incident response take effect immediately. Users only ever sign plain text.
 */

export const SESSION_TTL_MS = 7 * 24 * 3600_000;
const NONCE_TTL_MS = 10 * 60_000;

/** The site the message is bound to. Wallets compare `domain` with the page origin before they show a SIWE prompt. */
export interface Site {
  domain: string;
  uri: string;
}

export function siteFromRequest(req: NextRequest): Site {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { domain: host, uri: `${proto}://${host}` };
}

/** Cookie name: `__Host-` (Secure, path=/, no Domain) over HTTPS; a plain name on http://localhost. */
export const cookieName = (site: Site) => (site.uri.startsWith("https://") ? "__Host-mezonk_session" : "mezonk_session");

/**
 * EIP-4361 (Sign-In with Ethereum) message. The exact layout matters: wallets that recognise it
 * show a sign-in prompt, verify that `domain` matches the page, and do not treat it as an opaque signature.
 */
export const loginMessage = (wallet: string, nonce: string, issuedAt: string, site: Site) =>
  `${site.domain} wants you to sign in with your Ethereum account:\n${getAddress(wallet)}\n\n` +
  `Sign in to MEZONK. This signature costs nothing and does not authorize any transaction.\n\n` +
  `URI: ${site.uri}\nVersion: 1\nChain ID: ${deployment.chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function issueNonce(wallet: string, site: Site) {
  const db = await getDb();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  await db.insert(schema.authNonces).values({ nonce, wallet: wallet.toLowerCase(), expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return { nonce, issuedAt, message: loginMessage(wallet, nonce, issuedAt, site) };
}

/** EOA signatures locally; contract wallets (Safe etc.) through ERC-1271 via the RPC. */
async function verifyWalletSignature(wallet: Address, message: string, signature: Hex): Promise<boolean> {
  if (await verifyMessage({ address: wallet, message, signature }).catch(() => false)) return true;
  try {
    const code = await publicClient.getCode({ address: wallet });
    if (!code || code === "0x") return false;
    return await publicClient.verifyMessage({ address: wallet, message, signature });
  } catch {
    return false;
  }
}

/**
 * Verifies the signed challenge and opens a session. Returns the raw token (set as a cookie by the route)
 * or null on any failure. The nonce is consumed with a conditional UPDATE so two concurrent requests can't
 * both use it, and only after the signature is valid (a bad signature doesn't burn the user's nonce).
 */
export async function createSession(wallet: string, nonce: string, issuedAt: string, signature: Hex, site: Site) {
  const db = await getDb();
  const w = wallet.toLowerCase();
  const [row] = await db
    .select()
    .from(schema.authNonces)
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt), gt(schema.authNonces.expiresAt, new Date())));
  if (!row || row.wallet !== w) return null;
  if (!(await verifyWalletSignature(getAddress(wallet), loginMessage(wallet, nonce, issuedAt, site), signature))) return null;
  const consumed = await db
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt)))
    .returning({ nonce: schema.authNonces.nonce });
  if (consumed.length !== 1) return null;
  const [acct] = await db.select().from(schema.accounts).where(eq(schema.accounts.wallet, w));
  if (acct?.status === "suspended") return { suspended: true as const };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: sha256(token), wallet: w, expiresAt });
  await db.insert(schema.accounts).values({ wallet: w }).onConflictDoNothing();
  return { token, wallet: w, expiresAt: expiresAt.toISOString() };
}

function tokenFromRequest(req: NextRequest): { token: string; via: "cookie" | "bearer" } | null {
  const site = siteFromRequest(req);
  const c = req.cookies.get(cookieName(site))?.value;
  if (c) return { token: c, via: "cookie" };
  // Bearer is accepted for scripts and tests; browsers only ever hold the HttpOnly cookie.
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return { token: h.slice(7), via: "bearer" };
  return null;
}

/** State-changing cookie requests must come from this origin (CSRF defence on top of SameSite=Lax). */
function originAllowed(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return origin === siteFromRequest(req).uri;
}

/** Returns the verified wallet for this request's session, or null. Checks expiry, revocation and CSRF. */
export async function walletFromRequest(req: NextRequest): Promise<string | null> {
  const t = tokenFromRequest(req);
  if (!t || t.token.length < 20 || t.token.length > 100) return null;
  if (t.via === "cookie" && !originAllowed(req)) return null;
  const db = await getDb();
  const [s] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sha256(t.token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
  if (!s) return null;
  // Touch at most once a minute.
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, s.id));
  }
  return s.wallet;
}

export async function revokeSessionByToken(token: string, reason: string) {
  const db = await getDb();
  await db.update(schema.sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(schema.sessions.id, sha256(token)), isNull(schema.sessions.revokedAt)));
}

/** Revokes every live session of a wallet. Returns how many were revoked. */
export async function revokeAllSessions(wallet: string, reason: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(schema.sessions.wallet, wallet.toLowerCase()), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });
  return rows.length;
}

export function sessionTokenFromRequest(req: NextRequest) {
  return tokenFromRequest(req)?.token ?? null;
}
