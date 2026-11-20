import type express from "express";
import { errorBody, type HttpErrorCode } from "../contract/error-codes.js";

/**
 * A request a rate limit refused: 429 with Retry-After, and the same seconds
 * as `retryAfter` in the body, so a page can say how long to wait. The email
 * routes (#2805) and citizen OTP sends answer through this one place.
 */
export function sendRateLimited(
  response: express.Response,
  code: HttpErrorCode,
  error: string,
  retryAfter: number,
): express.Response {
  response.setHeader("Retry-After", String(retryAfter));
  return response.status(429).json(errorBody(code, error, { retryAfter }));
}
