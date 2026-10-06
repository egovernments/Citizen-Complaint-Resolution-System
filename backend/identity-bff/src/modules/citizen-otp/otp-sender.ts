import { config } from "../../infrastructure/config.js";

export interface OtpMessage {
  challengeId: string;
  purpose?: "signin" | "stepup" | "change_phone";
  tenantId: string;
  /** E.164, already validated against the tenant's mobile rule. */
  phoneNumber: string;
  code: string;
  expiresInSeconds: number;
  locale?: string;
}

/**
 * Delivers a citizen sign-in code. The identity service generates, stores and
 * checks the code; a sender only carries it and holds no provider logic or
 * credentials. A real channel (novu-bridge) replaces the log sender later.
 */
export interface OtpSender {
  readonly configured: boolean;
  send(message: OtpMessage): Promise<void>;
}

export class OtpDeliveryError extends Error {
  constructor(message: string, readonly code: "OTP_CHANNEL_UNAVAILABLE" | "OTP_RATE_LIMITED" = "OTP_CHANNEL_UNAVAILABLE") {
    super(message);
  }
}

export class HttpOtpSender implements OtpSender {
  get configured(): boolean {
    return config.identityCitizenOtpSender === "http" && Boolean(config.identityOtpSenderUrl);
  }

  async send(message: OtpMessage): Promise<void> {
    if (!this.configured) throw new OtpDeliveryError("No OTP channel is configured");
    try {
      const response = await fetch(config.identityOtpSenderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(config.identityOtpSenderTimeoutMs),
        redirect: "error",
        body: JSON.stringify({
          phone: message.phoneNumber, code: message.code,
          purpose: message.purpose || "signin", tenantId: message.tenantId,
          locale: message.locale, expiresIn: message.expiresInSeconds,
        }),
      });
      if (response.status === 429) throw new OtpDeliveryError("OTP channel rate limited", "OTP_RATE_LIMITED");
      if (!response.ok) throw new OtpDeliveryError("OTP channel unavailable");
    } catch (error) {
      if (error instanceof OtpDeliveryError) throw error;
      throw new OtpDeliveryError("OTP channel unavailable");
    }
  }
}

/**
 * Interim sender (#2189): writes the code to the BFF's log. Anyone who can
 * read that log can sign in as any citizen, so it runs only when
 * IDENTITY_CITIZEN_OTP_SENDER=log is set, and startup warns about it.
 */
export class LogOtpSender implements OtpSender {
  get configured(): boolean {
    return config.identityCitizenOtpSender === "log";
  }

  async send(message: OtpMessage): Promise<void> {
    if (!this.configured) throw new OtpDeliveryError("No OTP channel is configured");
    console.warn(JSON.stringify({
      otp: "identity.citizen_otp.log_sender",
      tenantId: message.tenantId,
      phoneNumber: message.phoneNumber,
      code: message.code,
      expiresInSeconds: message.expiresInSeconds,
    }));
  }
}

let sender: OtpSender | undefined;
const httpSender = new HttpOtpSender();
const logSender = new LogOtpSender();

export function otpSender(): OtpSender {
  return sender || (config.identityCitizenOtpSender === "http" ? httpSender : logSender);
}

/** Test hook, like `setCitizenTokenMinter`. */
export function setOtpSender(next: OtpSender): void {
  sender = next;
}

const OTP_CODE = /^\d{6}$/;

/**
 * The legacy egov-user fixed OTP, honoured only when explicitly enabled and
 * shaped like a real code (six digits); any other value is ignored, and
 * startup says so.
 */
export function fixedOtpCode(): string | null {
  const value = config.citizenLoginPasswordOtpFixedValue;
  return config.citizenLoginPasswordOtpFixedEnabled && OTP_CODE.test(value) ? value : null;
}

/**
 * `phone_otp` is offered only when a number can actually be proved: the
 * secret to hash codes, and a configured sender or a valid fixed code. A
 * delivery that fails later still answers OTP_CHANNEL_UNAVAILABLE.
 */
export function phoneOtpAvailable(): boolean {
  return Boolean(config.identityCitizenOtpSecret) && (otpSender().configured || fixedOtpCode() !== null);
}

/** Startup warnings for the two modes that weaken phone proof. */
export function warnAboutInsecureOtpModes(): void {
  if (!config.identityCitizenOtpSecret) return;
  if (config.identityCitizenOtpSender === "log") {
    console.warn("WARNING: citizen OTP codes are written to the log (IDENTITY_CITIZEN_OTP_SENDER=log). Development only.");
  }
  if (config.citizenLoginPasswordOtpFixedEnabled && fixedOtpCode() === null) {
    console.error("CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE is not six digits; the fixed code is IGNORED.");
  } else if (config.citizenLoginPasswordOtpFixedEnabled) {
    console.warn("WARNING: CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED is on: the fixed code signs in ANY citizen phone number. Development only.");
  }
}
