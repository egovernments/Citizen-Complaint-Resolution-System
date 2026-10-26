import { config } from "../infrastructure/config.js";

/** One pre-rendered message: novu-bridge's v1 envelope (`contract/envelope-v1.schema.json`). */
export type NotificationEnvelope = Record<string, unknown>;
/** `status` is the bridge ledger's: SENT (now, or earlier for the same transactionId), SKIPPED or FAILED. */
export interface DispatchOutcome { status: string; diagnostics: string[] }
export type NotificationDispatcher = (envelope: NotificationEnvelope) => Promise<DispatchOutcome>;

/**
 * novu-bridge's internal `POST /novu-adapter/v1/messages/_dispatch`. The BFF holds no Novu key:
 * the bridge owns the providers, the channel policy and the delivery ledger.
 */
export function novuBridgeConfigured(): boolean {
  return Boolean(config.novuBridgeUrl && config.novuBridgeToken);
}

async function postToBridge(envelope: NotificationEnvelope): Promise<DispatchOutcome> {
  const response = await fetch(`${config.novuBridgeUrl}/novu-adapter/v1/messages/_dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novu-Bridge-Token": config.novuBridgeToken },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(config.digitTimeoutMs),
    redirect: "error",
  });
  const body = await response.json().catch(() => null) as {
    data?: { status?: string; diagnostics?: string[] }; Errors?: Array<{ code?: string }>;
  } | null;
  if (!response.ok) throw new Error(`novu-bridge answered ${response.status} ${body?.Errors?.[0]?.code ?? ""}`.trim());
  return { status: body?.data?.status ?? "UNKNOWN", diagnostics: body?.data?.diagnostics ?? [] };
}

let dispatcher: NotificationDispatcher = postToBridge;

export function dispatchNotification(envelope: NotificationEnvelope): Promise<DispatchOutcome> {
  return dispatcher(envelope);
}

/** Test hook, like `setOtpSender`; no argument restores the bridge. */
export function setNotificationDispatcher(next?: NotificationDispatcher): void {
  dispatcher = next ?? postToBridge;
}
