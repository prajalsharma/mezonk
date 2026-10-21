import "server-only";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { cleanComment, commentProblem } from "@/lib/comments/text";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { profilesFor } from "@/server/profiles";
import { hasCap, type Roles } from "@/server/roles";

const { comments, commentReports, markets } = schema;

export class CommentError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const deny = (s: number, c: string, m: string) => new CommentError(s, c, m);

const PER_MINUTE = 6;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const EDIT_WINDOW_MS = 24 * 3600_000;
export const PAGE = 20;

type Row = typeof comments.$inferSelect;

async function serialize(rows: Row[], viewer: Roles | null) {
  const people = await profilesFor(rows.map((r) => r.author));
  const mod = hasCap(viewer, "comment:moderate");
  return rows.map((r) => {
    const mine = viewer?.wallet === r.author;
    const visible = r.status === "visible" || (r.status === "hidden" && (mod || mine));
    return {
      id: r.id,
      marketId: r.marketId,
      author: people.get(r.author)!,
      body: visible ? r.body : null,
      status: r.status as "visible" | "hidden" | "deleted",
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      moderationReason: r.status === "hidden" && (mod || mine) ? r.moderationReason : null,
      canEdit: mine && r.status === "visible" && Date.now() - r.createdAt.getTime() < EDIT_WINDOW_MS,
      canDelete: mine && r.status !== "deleted",
      canModerate: mod && r.status !== "deleted",
    };
  });
}

/** Newest first, cursor = id of the last comment of the previous page. Deleted comments keep their slot as a tombstone. */
export async function listComments(marketId: number, viewer: Roles | null, before?: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.marketId, marketId), before ? lt(comments.id, before) : undefined))
    .orderBy(desc(comments.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(comments).where(and(eq(comments.marketId, marketId), eq(comments.status, "visible")));
  return { items: await serialize(page, viewer), nextCursor: rows.length > PAGE ? page.at(-1)!.id : null, total: count?.n ?? 0 };
}

export async function createComment(viewer: Roles, marketId: number, raw: string) {
  const body = cleanComment(raw);
  const problem = commentProblem(body);
  if (problem) throw deny(422, "invalid", problem);
  const db = await getDb();
  const [m] = await db.select({ id: markets.marketId }).from(markets).where(eq(markets.marketId, marketId));
  if (!m) throw deny(404, "not_found", "No such market");
  const since = new Date(Date.now() - 60_000);
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(comments).where(and(eq(comments.author, viewer.wallet), gt(comments.createdAt, since)));
  if ((recent?.n ?? 0) >= PER_MINUTE) throw deny(429, "rate_limited", "You're commenting too fast. Wait a minute.");
  const [dup] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.author, viewer.wallet), eq(comments.body, body), gt(comments.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS))))
    .limit(1);
  if (dup) throw deny(409, "duplicate", "You just posted that.");
  const [row] = await db.insert(comments).values({ marketId, author: viewer.wallet, body }).returning();
  return (await serialize([row!], viewer))[0]!;
}

async function load(id: number) {
  const db = await getDb();
  const [row] = await db.select().from(comments).where(eq(comments.id, id));
  if (!row) throw deny(404, "not_found", "No such comment");
  return row;
}

export async function editComment(viewer: Roles, id: number, raw: string) {
  const row = await load(id);
  if (row.author !== viewer.wallet) throw deny(403, "forbidden", "You can only edit your own comments");
  if (row.status !== "visible") throw deny(409, "locked", "This comment can't be edited");
  if (Date.now() - row.createdAt.getTime() > EDIT_WINDOW_MS) throw deny(409, "locked", "Comments can be edited for 24 hours");
  const body = cleanComment(raw);
  const problem = commentProblem(body);
  if (problem) throw deny(422, "invalid", problem);
  const db = await getDb();
  const [r] = await db.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, id)).returning();
  return (await serialize([r!], viewer))[0]!;
}

/** Soft delete by the author: the slot stays as a tombstone, the text is no longer served. */
export async function deleteComment(viewer: Roles, id: number) {
  const row = await load(id);
  if (row.author !== viewer.wallet) throw deny(403, "forbidden", "You can only delete your own comments");
  const db = await getDb();
  await db.update(comments).set({ status: "deleted", body: "" }).where(eq(comments.id, id));
}

export async function reportComment(viewer: Roles, id: number, reason: string) {
  const row = await load(id);
  if (row.author === viewer.wallet) throw deny(409, "own", "You can't report your own comment");
  const r = reason.trim();
  if (r.length < 3 || r.length > 300) throw deny(422, "invalid", "Say briefly why (3–300 characters)");
  const db = await getDb();
  const ins = await db.insert(commentReports).values({ commentId: id, reporter: viewer.wallet, reason: r }).onConflictDoNothing().returning();
  if (!ins.length) throw deny(409, "already", "You already reported this comment");
}

/** Curators and administrators hide or restore a comment. Reason required and audited. */
export async function moderateComment(viewer: Roles, id: number, action: "hide" | "restore", reason: string) {
  if (!hasCap(viewer, "comment:moderate")) throw deny(403, "forbidden", "Only curators and administrators can moderate");
  const row = await load(id);
  if (row.status === "deleted") throw deny(409, "deleted", "This comment was deleted by its author");
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (5+ characters)");
  const db = await getDb();
  await db
    .update(comments)
    .set({ status: action === "hide" ? "hidden" : "visible", moderatedBy: viewer.wallet, moderationReason: reason.trim() })
    .where(eq(comments.id, id));
  await db.update(commentReports).set({ resolvedAt: new Date(), resolvedBy: viewer.wallet }).where(and(eq(commentReports.commentId, id), sql`${commentReports.resolvedAt} is null`));
  await audit(viewer.wallet, `comment.${action}`, "comment", String(id), { marketId: row.marketId, author: row.author, reason: reason.trim() });
}

/** Open reports, for the curator dashboard. */
export async function openReports() {
  const db = await getDb();
  const rows = await db
    .select({ r: commentReports, c: comments })
    .from(commentReports)
    .innerJoin(comments, eq(comments.id, commentReports.commentId))
    .where(sql`${commentReports.resolvedAt} is null and ${comments.status} <> 'deleted'`)
    .orderBy(desc(commentReports.id))
    .limit(100);
  return rows.map(({ r, c }) => ({ reportId: r.id, reason: r.reason, reporter: r.reporter, createdAt: r.createdAt.toISOString(), comment: { id: c.id, marketId: c.marketId, author: c.author, body: c.body, status: c.status } }));
}
