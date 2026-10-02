package org.egov.novubridge.service.delivery;

import lombok.Builder;
import lombok.Value;

import java.util.Map;

/** {@code accepted} means queued, never delivered. {@code providerCode} is persisted verbatim. */
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
