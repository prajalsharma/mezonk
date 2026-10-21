import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import type { ProfileInput } from "@/lib/profile/username";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";

const { profiles, media, marketProposals, markets, comments, marketSlugs } = schema;

export class ProfileError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface PublicProfile {
  wallet: string;
  username: string | null;
  displayName: string | null;
  bio: string;
  avatarUrl: string | null;
  createdAt: string | null;
}

/** Profiles for many wallets at once (for comment lists, creator chips). Hidden profiles show as plain addresses. */
export async function profilesFor(wallets: string[]): Promise<Map<string, PublicProfile>> {
  const ws = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const out = new Map<string, PublicProfile>();
  if (!ws.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ p: profiles, url: media.url, mstatus: media.status })
    .from(profiles)
    .leftJoin(media, eq(media.id, profiles.avatarMediaId))
    .where(inArray(profiles.wallet, ws));
  for (const w of ws) out.set(w, { wallet: getAddress(w), username: null, displayName: null, bio: "", avatarUrl: null, createdAt: null });
  for (const { p, url, mstatus } of rows) {
    if (p.hidden) continue;
    out.set(p.wallet, {
      wallet: getAddress(p.wallet),
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: mstatus === "attached" ? url : null,
      createdAt: p.createdAt.toISOString(),
    });
  }
  return out;
}

export async function myProfile(wallet: string) {
  return (await profilesFor([wallet])).get(wallet.toLowerCase())!;
}

/** Create or update the caller's own profile. Username uniqueness is the database's job. */
export async function upsertProfile(wallet: string, input: ProfileInput) {
  const w = wallet.toLowerCase();
  const db = await getDb();
  if (input.avatarMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, input.avatarMediaId));
    if (!m || m.owner !== w || m.kind !== "avatar" || m.status === "removed") throw new ProfileError(422, "bad_avatar", "That image can't be used as your avatar");
  }
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(profiles).where(eq(profiles.wallet, w));
      const avatarMediaId = input.avatarMediaId === undefined ? (before?.avatarMediaId ?? null) : input.avatarMediaId;
      const row = { username: input.username, usernameNormalized: input.username, displayName: input.displayName, bio: input.bio, avatarMediaId, updatedAt: new Date() };
      await tx.insert(profiles).values({ wallet: w, ...row }).onConflictDoUpdate({ target: profiles.wallet, set: row });
      if (avatarMediaId) await tx.update(media).set({ status: "attached", attachedAt: new Date() }).where(eq(media.id, avatarMediaId));
      if (before?.avatarMediaId && before.avatarMediaId !== avatarMediaId) {
        await tx.update(media).set({ status: "removed" }).where(and(eq(media.id, before.avatarMediaId), eq(media.owner, w)));
      }
    });
  } catch (e) {
    if (String((e as { cause?: unknown }).cause ?? e).includes("profiles_username") || String(e).includes("profiles_username")) {
      throw new ProfileError(409, "username_taken", "That username is taken");
    }
    throw e;
  }
  await audit(w, "profile.update", "wallet", w, { username: input.username });
  return myProfile(w);
}

export async function usernameAvailable(username: string, wallet?: string) {
  const db = await getDb();
  const [row] = await db.select({ wallet: profiles.wallet }).from(profiles).where(eq(profiles.usernameNormalized, username.toLowerCase()));
  return !row || row.wallet === wallet?.toLowerCase();
}

/** Public profile by handle or address, with authored markets and recent comments. */
export async function publicProfile(handle: string) {
  const db = await getDb();
  let wallet: string | null = null;
  if (isAddress(handle, { strict: false })) wallet = handle.toLowerCase();
  else {
    const [row] = await db.select({ wallet: profiles.wallet, hidden: profiles.hidden }).from(profiles).where(eq(profiles.usernameNormalized, handle.toLowerCase()));
    if (!row || row.hidden) return null;
    wallet = row.wallet;
  }
  const profile = (await profilesFor([wallet])).get(wallet)!;
  const created = await db
    .select({ id: markets.marketId, question: markets.question, slug: marketSlugs.slug, createdAt: markets.createdAt, finalOutcome: markets.finalOutcome })
    .from(markets)
    .leftJoin(marketSlugs, and(eq(marketSlugs.marketId, markets.marketId), eq(marketSlugs.isCurrent, true)))
    .where(eq(markets.creator, wallet))
    .orderBy(desc(markets.createdAt))
    .limit(50);
  const suggested = await db
    .select({ id: marketProposals.id, status: marketProposals.status, metadata: marketProposals.metadata, marketId: marketProposals.marketId })
    .from(marketProposals)
    .where(and(eq(marketProposals.author, wallet), sql`${marketProposals.status} not in ('draft','withdrawn')`))
    .orderBy(desc(marketProposals.updatedAt))
    .limit(50);
  const recent = await db
    .select({ id: comments.id, marketId: comments.marketId, body: comments.body, createdAt: comments.createdAt, slug: marketSlugs.slug, question: markets.question })
    .from(comments)
    .innerJoin(markets, eq(markets.marketId, comments.marketId))
    .leftJoin(marketSlugs, and(eq(marketSlugs.marketId, comments.marketId), eq(marketSlugs.isCurrent, true)))
    .where(and(eq(comments.author, wallet), eq(comments.status, "visible")))
    .orderBy(desc(comments.id))
    .limit(20);
  return {
    profile,
    markets: created.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    suggestions: suggested.map((s) => ({ id: s.id, status: s.status, question: (s.metadata as { question: string }).question, marketId: s.marketId })),
    comments: recent.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  };
}
