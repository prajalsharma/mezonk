import { z } from "zod";

/**
 * Handle rules. Handles are unique (case-insensitive, enforced by a unique index on the normalized
 * value) and mutable; the wallet is the identity. Names that could pass as staff or as the Mezo/MEZONK
 * teams are refused.
 */
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

const RESERVED = new Set([
  "admin", "administrator", "mod", "moderator", "curator", "curators", "creator", "creators", "resolver", "arbitrator",
  "support", "help", "official", "team", "staff", "security", "root", "system", "api", "null", "undefined", "anonymous",
  "settings", "profile", "profiles", "markets", "market", "suggest", "proposals", "curate", "resolve", "portfolio",
  "activity", "docs", "status", "discover", "u", "me", "you", "owner", "mezo", "mezonk", "musd", "bitcoin", "btc",
]);
const IMPERSONATION = /(mezo|mezonk|admin|moderat|official|support|staff|security|thesis|curator)/;

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export function usernameProblem(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!USERNAME_RE.test(u)) return "Use 3–20 characters: letters, numbers and underscores, starting with a letter.";
  if (RESERVED.has(u)) return "That name is reserved.";
  if (IMPERSONATION.test(u)) return "Names that could pass as MEZONK, Mezo or staff aren't allowed.";
  return null;
}

/** Strips control and zero-width characters and collapses whitespace. */
export const cleanText = (s: string) =>
  s
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

export function displayNameProblem(raw: string): string | null {
  const d = cleanText(raw);
  if (d.length < 2 || d.length > 40) return "Use 2–40 characters.";
  if (/\b(official|admin|administrator|moderator|mezo team|mezonk team|support)\b/i.test(d)) return "Names that could pass as staff or an official account aren't allowed.";
  return null;
}

export const profileInputSchema = z
  .object({
    username: z.string(),
    displayName: z.string(),
    bio: z.string().max(280).default(""),
    avatarMediaId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const u = usernameProblem(v.username);
    if (u) ctx.addIssue({ code: "custom", path: ["username"], message: u });
    const d = displayNameProblem(v.displayName);
    if (d) ctx.addIssue({ code: "custom", path: ["displayName"], message: d });
  })
  .transform((v) => ({
    username: normalizeUsername(v.username),
    displayName: cleanText(v.displayName),
    bio: cleanText(v.bio).slice(0, 280),
    /** undefined = keep the current avatar, null = remove it, id = use this upload. */
    avatarMediaId: v.avatarMediaId,
  }));
export type ProfileInput = z.output<typeof profileInputSchema>;
