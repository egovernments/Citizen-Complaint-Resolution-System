package org.egov.novubridge.repository;

import org.egov.novubridge.web.models.DispatchLogEntry;

/**
 * The ledger row the pre-rendered pipeline never writes: the channel-less row, for a decision taken
 * before there was a channel or recipient to name. {@code transaction_id = <seed>:NONE} keeps a
 * redelivery upserting the same row under the unique key.
 */
public final class DispatchLogRows {

    private DispatchLogRows() {
    }

    /** Pre-filled; the caller adds status, error code/message and the identity fields it knows. */
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
