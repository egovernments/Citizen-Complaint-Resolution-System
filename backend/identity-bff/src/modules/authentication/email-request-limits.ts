import type express from "express";
import { sendRateLimited } from "../../app/rate-limited.js";
import { rateLimitNetwork, reserveInWindows } from "../../infrastructure/rate-limit.js";

export type EmailRequestRefusal = { code: "EMAIL_RATE_LIMITED" | "NETWORK_RATE_LIMITED"; retryAfter: number };
export type EmailRequestAllowance = { allowed: true } | ({ allowed: false } & EmailRequestRefusal);

/**
 * Limits for the two routes that send an email: sign-up links and password
 * links (#2805).
 *
 * A request is counted per network and per address in one atomic step. The
 * network (the caller's IP, IPv6 by /64) is checked first. Over its limit,
 * the request is refused with NETWORK_RATE_LIMITED and the address is not
 * charged. Within it, the address is checked. Over that limit, the request is
 * refused with EMAIL_RATE_LIMITED and the network keeps the charge, so probing
 * addresses spends the network's budget too. The network limit is the higher
 * one (20 by default, as for citizen OTP) because an office behind one NAT
 * shares an IP.
 *
 * What a refusal tells a caller: the address counter is keyed by the address
 * as typed, whether or not an account has it, so a refusal says nothing about
 * whether an account exists. It does show that the address had recent
 * requests. #2805 accepts that, so a person is told why no email came instead
 * of getting a 202 for an email that was never sent.
 */
export async function reserveEmailRequest(input: {
  addressKey: string;
  /** The network bucket's key without the network, which is appended. */
  networkKeyPrefix: string;
  ip: string | undefined;
  addressLimit: number;
  ipLimit: number;
  windowSeconds: number;
}): Promise<EmailRequestAllowance> {
  const reservation = await reserveInWindows([
    {
      key: `${input.networkKeyPrefix}:${rateLimitNetwork(input.ip)}`,
      limit: input.ipLimit,
      windowSeconds: input.windowSeconds,
      keepOnRefusal: true,
    },
    { key: input.addressKey, limit: input.addressLimit, windowSeconds: input.windowSeconds },
  ]);
  if (reservation.allowed) return { allowed: true };
  return {
    allowed: false,
    code: reservation.refusedBy === 0 ? "NETWORK_RATE_LIMITED" : "EMAIL_RATE_LIMITED",
    retryAfter: reservation.retryAfter,
  };
}

const LIMITED_TEXT = {
  EMAIL_RATE_LIMITED: "Too many emails were requested for this address. Try again later.",
  NETWORK_RATE_LIMITED: "Too many requests from this network. Try again later.",
} as const;

/** Over a limit the caller is told so, never "we've sent you an email", since nothing is sent. */
export function refuseEmailRequest(response: express.Response, refusal: EmailRequestRefusal): express.Response {
  return sendRateLimited(response, refusal.code, LIMITED_TEXT[refusal.code], refusal.retryAfter);
}
