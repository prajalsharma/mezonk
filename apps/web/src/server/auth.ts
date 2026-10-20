import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getAddress, verifyMessage, type Address } from "viem";
import { deployment } from "@/lib/chain/config";
import { getDb, schema } from "@/server/db/client";

/**
 * Wallet sessions. Flow: GET /api/auth/nonce?wallet= → sign the message → POST /api/auth/session →
 * bearer token (HMAC-signed, 24h). Signing proves control of the wallet; roles are then read from chain.
 * Never ask for keys; the only thing a wallet signs is a plain text statement.
 */

const TTL_MS = 24 * 3600_000;
const NONCE_TTL_MS = 10 * 60_000;

function secret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (s) return Buffer.from(s, "utf8");
  // Local development only: ephemeral per-process secret. Production must set AUTH_SECRET.
  const g = globalThis as unknown as { __mezonkAuthSecret?: Buffer };
  if (!g.__mezonkAuthSecret) {
    if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) {
      throw new Error("AUTH_SECRET is required in production");
    }
    g.__mezonkAuthSecret = randomBytes(32);
  }
  return g.__mezonkAuthSecret;
}

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

/**
 * EIP-4361 (Sign-In with Ethereum) message. The exact layout matters: wallets that recognise it
 * show a sign-in prompt, verify that `domain` matches the page, and do not treat it as an opaque signature.
 */
export const loginMessage = (wallet: string, nonce: string, issuedAt: string, site: Site) =>
  `${site.domain} wants you to sign in with your Ethereum account:\n${getAddress(wallet)}\n\n` +
  `Sign in to MEZONK. This signature costs nothing and does not authorize any transaction.\n\n` +
  `URI: ${site.uri}\nVersion: 1\nChain ID: ${deployment.chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

export async function issueNonce(wallet: string, site: Site) {
  const db = await getDb();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  await db.insert(schema.authNonces).values({
    nonce,
    wallet: wallet.toLowerCase(),
    expiresAt: new Date(Date.now() + NONCE_TTL_MS),
  });
  return { nonce, issuedAt, message: loginMessage(wallet, nonce, issuedAt, site) };
}

export async function createSession(wallet: string, nonce: string, issuedAt: string, signature: `0x${string}`, site: Site) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.authNonces)
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt), gt(schema.authNonces.expiresAt, new Date())));
  if (!row || row.wallet !== wallet.toLowerCase()) return null;
  const ok = await verifyMessage({ address: wallet as Address, message: loginMessage(wallet, nonce, issuedAt, site), signature }).catch(() => false);
  if (!ok) return null;
  await db.update(schema.authNonces).set({ usedAt: new Date() }).where(eq(schema.authNonces.nonce, nonce));
  const payload = Buffer.from(JSON.stringify({ w: wallet.toLowerCase(), e: Date.now() + TTL_MS })).toString("base64url");
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { token: `${payload}.${mac}`, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}

/** Returns the lowercase wallet for a valid bearer token, else null. */
export function walletFromRequest(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const [payload, mac] = h.slice(7).split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const { w, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { w: string; e: number };
    if (typeof w !== "string" || Date.now() > e) return null;
    return w;
  } catch {
    return null;
  }
}
