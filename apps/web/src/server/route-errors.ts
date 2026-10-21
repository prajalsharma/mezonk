import "server-only";
import { z } from "zod";
import { fail } from "@/lib/api/http";

/** Maps domain errors (anything with status/code/message) and zod errors to the API error shape. */
export function domainError(e: unknown): Response {
  if (e && typeof e === "object" && "status" in e && "code" in e && e instanceof Error) {
    const d = e as Error & { status: number; code: string };
    return fail(d.status, d.code, d.message);
  }
  if (e instanceof z.ZodError) return fail(400, "bad_request", "Invalid request", e.flatten());
  throw e;
}
