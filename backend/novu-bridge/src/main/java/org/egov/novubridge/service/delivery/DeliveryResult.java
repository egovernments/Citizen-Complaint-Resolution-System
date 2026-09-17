package org.egov.novubridge.service.delivery;

import lombok.Builder;
import lombok.Value;

import java.util.Map;

/**
 * What a {@link DeliveryProvider} reports back. {@code accepted} means the transport took the
 * message (queued) — never that it was delivered. {@code providerCode} is the provider's own
 * failure code (NB_NOVU_*, NB_SMSCOUNTRY_*); the pipeline persists it verbatim so the dispatch
 * log never attributes one provider's failure to another.
 */
@Value
@Builder
public class DeliveryResult {
    boolean accepted;
    /** Null when accepted. */
    String providerCode;
    /** Null when accepted. */
    String providerMessage;
    /** Provider-side correlation id (Novu transactionId, SMSCountry jobId) when known. */
    String providerRef;
    /** Raw transport status when there was one (HTTP code for Novu; synthetic for direct gateways). */
    Integer statusCode;
    /** The provider's raw response, persisted as the delivery receipt. */
    Map<String, Object> rawResponse;

    public static DeliveryResult accepted(Integer statusCode, String providerRef, Map<String, Object> raw) {
        return DeliveryResult.builder().accepted(true).statusCode(statusCode).providerRef(providerRef).rawResponse(raw).build();
    }

    public static DeliveryResult failed(String code, String message, Integer statusCode, Map<String, Object> raw) {
        return DeliveryResult.builder().accepted(false).providerCode(code).providerMessage(message)
                .statusCode(statusCode).rawResponse(raw).build();
    }
}
