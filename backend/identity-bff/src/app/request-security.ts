import type express from "express";
import { config } from "../infrastructure/config.js";

export function hasTrustedWriteOrigin(request: express.Request): boolean {
  const origin = request.get("origin");
  return !origin || config.identityAllowedOrigins.includes(origin);
}
