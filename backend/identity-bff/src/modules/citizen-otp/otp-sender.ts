import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";

export interface OtpMessage {
  challengeId: string;
  tenantId: string;
  /** E.164, already validated against the tenant's mobile rule. */
  phoneNumber: string;
  code: string;
  expiresInSeconds: number;
  locale?: string;
}

/**
 * Delivers a citizen sign-in code. The identity service generates, stores and
 * checks the code; a sender only carries it. Implementations hold no provider
 * logic or credentials.
 */
export interface OtpSender {
  readonly configured: boolean;
  send(message: OtpMessage): Promise<void>;
}

export class OtpDeliveryError extends Error {}

/**
 * The only implementation: novu-bridge's `messages/_send`, given a thin event
 * (novu-bridge `thin-event-v1`). The phone goes in `recipients` because the
 * citizen may have no DIGIT account yet; routing, template, wording, channel
 * and provider are the notification box's decision.
 */
export class NovuBridgeOtpSender implements OtpSender {
  get configured(): boolean {
    return Boolean(config.notificationMessageSendUrl);
  }

  async send(message: OtpMessage): Promise<void> {
    if (!this.configured) throw new OtpDeliveryError("No OTP sender is configured");
    const event = {
      kind: "THIN",
      schemaVersion: "1",
      eventId: randomUUID(),
      eventType: config.notificationOtpEventType,
      eventTime: new Date().toISOString(),
      producer: "identity-bff",
      module: "IDENTITY",
      eventName: "IDENTITY.CITIZEN.OTP",
      entityType: "OTP_CHALLENGE",
      entityId: message.challengeId,
      tenantId: message.tenantId,
      // One challenge is delivered at most once, whatever retries happen.
      transactionSeed: message.challengeId,
      recipients: [{
        type: "CITIZEN",
        phone: message.phoneNumber,
        ...(message.locale && { locale: message.locale }),
      }],
      data: {
        otp: message.code,
        expiryMinutes: String(Math.ceil(message.expiresInSeconds / 60)),
      },
    };
    let response: Response;
    try {
      response = await fetch(config.notificationMessageSendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ RequestInfo: { apiId: "digit-identity-bff" }, event }),
        signal: AbortSignal.timeout(config.digitTimeoutMs),
      });
    } catch {
      throw new OtpDeliveryError("OTP send request failed");
    }
    // Only the status is kept: the body may echo the code or the phone.
    await response.body?.cancel();
    if (!response.ok) throw new OtpDeliveryError(`OTP send returned ${response.status}`);
  }
}

let sender: OtpSender = new NovuBridgeOtpSender();

export function otpSender(): OtpSender {
  return sender;
}

/** Test hook, like `setCitizenTokenMinter`. */
export function setOtpSender(next: OtpSender): void {
  sender = next;
}

/** `phone_otp` is offered only when a code can be both hashed and delivered. */
export function phoneOtpAvailable(): boolean {
  return Boolean(config.identityCitizenOtpSecret) && sender.configured;
}
