/**
 * Row → display for the Notification Logs screen. Pure, so it can be tested
 * without mounting the list (component files can't be imported in this suite).
 *
 * Two things here are not cosmetic:
 *
 *  - **Channel `NONE`.** The bridge writes a row with no channel at all when it
 *    reached a terminal decision before a channel existed — nobody routed,
 *    nobody found, an audience scheme it cannot read, a refused fan-out, an
 *    event not in the catalogue. Those rows carry `channel = NONE` and
 *    `recipient_value = 'none'` (see contract/outputs.md). They are exactly the
 *    rows an operator hunting "why did nothing arrive" needs, so the channel
 *    filter has to offer them instead of hiding them behind "clear the filter".
 *
 *  - **`recipient_value = 'none'`.** It is the literal word, not a phone
 *    number. Masking it the way a real recipient is masked prints `***one`,
 *    which reads like a redacted contact that does not exist. It is passed
 *    through untouched instead.
 */

/** The pseudo-channel the bridge writes when the decision preceded any channel. */
export const NO_CHANNEL = 'NONE';

/** Channel filter choices. `NONE` is a real, queryable value of the API's
 *  `channel` parameter — not a UI-only "clear the filter" trick. */
export const CHANNEL_CHOICES = [
  { id: 'SMS', name: 'SMS' },
  { id: 'EMAIL', name: 'Email' },
  { id: 'WHATSAPP', name: 'WhatsApp' },
  { id: NO_CHANNEL, name: 'No channel (nothing sent)' },
];

/** Filter choices for the API's `sourcePath` parameter. The wording matches the
 *  operator guide: which half produced the row, in plain words. */
export const SOURCE_PATH_CHOICES = [
  { id: 'PRERENDERED', name: 'Sent as finished message' },
  { id: 'RESOLVED', name: 'Routed by notifications' },
];

/** One line, non-technical, explaining the two source-path values. */
export const SOURCE_PATH_HELP =
  'Produced by: "Sent as finished message" — the module that raised the event also wrote the words. '
  + '"Routed by notifications" — the notification service decided who to tell and wrote the words from your templates. '
  + 'Rows with no channel are decisions taken before there was a channel to send on: nothing was sent.';

/** What to print in a cell, and whether it should be muted (a non-value). */
export interface CellText {
  text: string;
  muted: boolean;
}

const EMPTY: CellText = { text: '--', muted: true };

/** Terminal states novu-bridge writes. SENT = the transport accepted the message;
 *  DELIVERED / BOUNCED arrive later via provider receipts (when wired); REJECTED =
 *  the event failed validation and was DLQ'd. */
export const STATUS_CHOICES = [
  { id: 'SENT', name: 'Sent (accepted by transport)' },
  { id: 'DELIVERED', name: 'Delivered' },
  { id: 'BOUNCED', name: 'Bounced' },
  { id: 'FAILED', name: 'Failed' },
  { id: 'SKIPPED', name: 'Skipped' },
  { id: 'REJECTED', name: 'Rejected (bad event)' },
  { id: 'RECEIVED', name: 'Received (dry run)' },
];

/** Operator test-sends are real rows at this tenant, flagged is_test; hidden unless asked. */
export const TEST_CHOICES = [{ id: 'true', name: 'Show test sends' }];

/** A dispatch-log row as this screen reads it: only `channel` and
 *  `recipientValue` matter here, and both may be absent. */
export type LogRow = Record<string, unknown>;

/** True when this row is one of the channel-less decisions. */
export function isChannelless(record: LogRow): boolean {
  return String(record?.channel ?? '').toUpperCase() === NO_CHANNEL;
}

/** Channel cell. `NONE` reads as words, not as an enum shouted at the operator. */
export function channelDisplay(value: unknown): CellText {
  const raw = String(value ?? '').trim();
  if (!raw) return EMPTY;
  if (raw.toUpperCase() === NO_CHANNEL) return { text: 'No channel', muted: true };
  const choice = CHANNEL_CHOICES.find((c) => c.id === raw.toUpperCase());
  return { text: choice ? choice.name : raw, muted: false };
}

/** Source-path cell. An unknown value is shown verbatim rather than swallowed —
 *  a bridge newer than this screen must not render as a blank column. */
export function sourcePathDisplay(value: unknown): CellText {
  const raw = String(value ?? '').trim();
  if (!raw) return EMPTY;
  const choice = SOURCE_PATH_CHOICES.find((c) => c.id === raw.toUpperCase());
  return { text: choice ? choice.name : raw, muted: false };
}

/** Mask a recipient (phone/email) so the log never renders a full PII value:
 *  keep the domain for emails, the last 3 digits for phones.
 *  The server also masks recipient_value/transaction_id (novu-bridge PiiMask) —
 *  this is defense-in-depth for older bridges. */
export function maskRecipient(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '--';
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    const head = local.slice(0, 1);
    return `${head}***@${domain}`;
  }
  if (s.length <= 3) return '***';
  return `***${s.slice(-3)}`;
}

/** Recipient cell. `none` on a channel-less row is the literal word the bridge
 *  wrote (lower case, so it cannot be mistaken for a subscriber) — never mask it. */
export function recipientDisplay(record: LogRow): CellText {
  const raw = String(record?.recipientValue ?? '').trim();
  if (!raw) return isChannelless(record) ? { text: 'none', muted: true } : EMPTY;
  if (raw.toLowerCase() === 'none') return { text: 'none', muted: true };
  return { text: maskRecipient(raw), muted: false };
}
