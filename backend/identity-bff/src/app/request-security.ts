import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { config } from "../infrastructure/config.js";

export function hasTrustedWriteOrigin(request: express.Request): boolean {
  const origin = request.get("origin");
  return !origin || config.identityAllowedOrigins.includes(origin);
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Constant-time workload check of `Authorization: Bearer <token>` against any non-empty token. */
export function bearerMatches(request: express.Request, tokens: readonly string[]): boolean {
  const header = request.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return supplied.length > 0 && tokens.some((token) => token.length > 0 && sameSecret(supplied, token));
}
