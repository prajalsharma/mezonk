import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { cookieName, createSession, revokeSessionByToken, SESSION_TTL_MS, sessionTokenFromRequest, siteFromRequest, walletFromRequest } from "@/server/auth";
import { maybeBootstrapAdmin } from "@/server/admin";

export const dynamic = "force-dynamic";
const body = z.object({ wallet: addressSchema, nonce: z.string().regex(/^[0-9a-f]{32}$/), issuedAt: z.string().datetime(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

/** Current session (the cookie is HttpOnly, so the page asks the server who it is). */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const wallet = await walletFromRequest(req);
    return ok({ wallet }, { maxAge: 0 });
  });
}

/** Verify a signed challenge and open a session. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "session", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid sign-in payload");
    const site = siteFromRequest(req);
    const s = await createSession(p.data.wallet, p.data.nonce, p.data.issuedAt, p.data.signature as `0x${string}`, site);
    if (!s) return fail(401, "bad_signature", "Signature or nonce is invalid or expired");
    if ("suspended" in s) return fail(403, "suspended", "This wallet is suspended. Contact the MEZONK team.");
    await maybeBootstrapAdmin(s.wallet);
    const res = NextResponse.json({ wallet: s.wallet, expiresAt: s.expiresAt }, { headers: { "cache-control": "no-store" } });
    res.cookies.set(cookieName(site), s.token, {
      httpOnly: true,
      secure: site.uri.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  });
}

/** Log out: revoke the session server-side and clear the cookie. */
export function DELETE(req: NextRequest) {
  return guarded(async () => {
    const token = sessionTokenFromRequest(req);
    if (token) await revokeSessionByToken(token, "logout");
    const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    res.cookies.set(cookieName(siteFromRequest(req)), "", { httpOnly: true, path: "/", maxAge: 0, secure: siteFromRequest(req).uri.startsWith("https://"), sameSite: "lax" });
    return res;
  });
}
