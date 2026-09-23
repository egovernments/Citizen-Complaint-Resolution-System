package org.egov.novubridge.service.receipts;

import lombok.Builder;
import lombok.Value;

import java.util.Map;

/** A provider's delivery report, normalised: which row (by transactionId and/or providerRef) and what happened. */
@Value
@Builder
public class DeliveryReceipt {
    /** DELIVERED | BOUNCED | FAILED, or null when the report carries no terminal outcome (e.g. "queued"). */
    String status;
    String transactionId;
    String providerRef;
    String providerStatus;
    String errorMessage;
    Map<String, Object> raw;

    public boolean isTerminal() {
        return status != null;
    }

    public boolean isAddressable() {
        return (transactionId != null && !transactionId.isBlank()) || (providerRef != null && !providerRef.isBlank());
    }
}
