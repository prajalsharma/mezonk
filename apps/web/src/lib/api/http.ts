import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodTypeAny } from "zod";

/** Stable error envelope for every API route. Never includes stack traces. */
export interface ApiError {
  error: { code: string; message: string; issues?: unknown };
}

export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

export const ok = (data: unknown, init?: { maxAge?: number; status?: number }) =>
  NextResponse.json(jsonSafe(data), {
    status: init?.status ?? 200,
    headers: { "Cache-Control": `public, max-age=0, s-maxage=${init?.maxAge ?? 5}, stale-while-revalidate=30` },
  });

export const fail = (status: number, code: string, message: string, issues?: unknown) =>
  NextResponse.json<ApiError>({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });

export function parseQuery<T extends ZodTypeAny>(req: NextRequest, schema: T) {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  return schema.safeParse(obj) as z.SafeParseReturnType<unknown, z.infer<T>>;
}

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed 20-byte address")
  .transform((s) => s.toLowerCase());

export const idSchema = z.coerce.number().int().positive().max(2 ** 31 - 1);

export const pageSchema = {
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
};

/**
 * Fixed-window rate limiter. In-memory, so it is per server instance: adequate for abuse
 * damping on a single node; put a shared limiter (edge/WAF) in front for multi-instance deploys.
 */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(req: NextRequest, name: string, max: number, windowMs: number): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${name}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error("[api]", e);
    return fail(503, "unavailable", "The data service is temporarily unavailable. On-chain state is unaffected.");
  }
}
