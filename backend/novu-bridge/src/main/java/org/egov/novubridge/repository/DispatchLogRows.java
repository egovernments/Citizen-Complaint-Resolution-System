package org.egov.novubridge.repository;

import org.egov.novubridge.web.models.DispatchLogEntry;

/**
 * The shapes of a ledger row that the pre-rendered pipeline never writes, in one place so that
 * every writer of one agrees.
 *
 * <p>There is exactly one such shape today: the <b>channel-less row</b>. "Exactly one row per
 * terminal outcome" used to be true only downstream of a producer's own silent drops — a producer
 * that found no routing, or no recipient, logged a line and dropped the event, and the ledger
 * never heard about it. Once the box makes those decisions itself they become visible, and they
 * are decisions taken BEFORE there is a channel or a recipient to name.
 *
 * <p>So such a row carries {@code channel = NONE}, {@code recipient_value = none} and
 * {@code transaction_id = <seed>:NONE}. That last part matters: the ledger's unique key is
 * {@code (transaction_id, channel, recipient_value)}, and appending the pseudo-channel keeps a
 * redelivery of the same event upserting the same row rather than accumulating duplicates —
 * the same property the real rows have, for the same reason.
 */
public final class DispatchLogRows {

    private DispatchLogRows() {
    }

    /**
     * A channel-less row for a thin event, pre-filled with everything that is true by
     * construction. The caller adds {@code status}, {@code lastErrorCode},
     * {@code lastErrorMessage} and the identity fields it knows.
     *
     * @param transactionSeed the event's resolved idempotency seed
     *                        ({@code ThinEvent.resolvedTransactionSeed()})
     */
    public static DispatchLogEntry.DispatchLogEntryBuilder channelLess(String transactionSeed) {
        long now = System.currentTimeMillis();
        return DispatchLogEntry.builder()
                .channel(DispatchLogEntry.CHANNEL_NONE)
                .recipientValue(DispatchLogEntry.RECIPIENT_NONE)
                .transactionId(transactionSeed + ":" + DispatchLogEntry.CHANNEL_NONE)
                .sourcePath(DispatchLogEntry.SOURCE_PATH_RESOLVED)
                .attemptCount(1)
                .isTest(false)
                .createdTime(now)
                .lastModifiedTime(now);
    }
}
