/**
 * Comment bodies are plain text. No HTML or markdown is interpreted anywhere; React renders the string
 * as text, so markup like <script> shows literally. This only normalises and bounds the input.
 */
export const COMMENT_MAX = 2000;

export function cleanComment(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function commentProblem(body: string): string | null {
  if (body.length < 1) return "Write something first.";
  if (body.length > COMMENT_MAX) return `Keep it under ${COMMENT_MAX.toLocaleString()} characters.`;
  return null;
}
