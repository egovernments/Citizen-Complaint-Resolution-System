package org.egov.novubridge.service.receipts;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Normalises provider delivery reports into a {@link DeliveryReceipt}. Tolerant by design:
 * providers version their webhook shapes independently of us, so this looks for the few
 * fields that matter (a correlation id and an outcome word) anywhere in the payload rather
 * than binding to one exact schema.
 *
 * <ul>
 *   <li><b>novu</b> — Novu delivery webhooks: {@code transactionId} (top level or under
 *       {@code payload}/{@code data}/{@code message}) plus a {@code status}/{@code event}/{@code type}
 *       word such as {@code message.delivered}, {@code delivered}, {@code sent}, {@code failed}.</li>
 *   <li><b>smscountry</b> — bulk-API delivery reports: {@code jobno}/{@code jobId}/{@code JobNo}
 *       (our {@code provider_ref}) plus {@code status} such as {@code DELIVRD}, {@code UNDELIV},
 *       {@code EXPIRED}, {@code REJECTD}.</li>
 * </ul>
 * Outcome words map to DELIVERED / BOUNCED / FAILED; anything non-terminal (queued, sent,
 * accepted) yields a receipt with a null status, which the endpoint acknowledges but ignores.
 */
@Component
public class ReceiptParser {

    private static final List<String> ID_KEYS = List.of("transactionId", "transaction_id", "txn");
    private static final List<String> REF_KEYS = List.of("providerRef", "provider_ref", "jobno", "jobId", "JobNo", "jobid", "messageId", "message_id", "sid", "MessageSid");
    private static final List<String> STATUS_KEYS = List.of("status", "Status", "event", "type", "eventType", "deliveryStatus", "MessageStatus");
    private static final List<String> ERROR_KEYS = List.of("error", "errorMessage", "reason", "ErrorMessage", "errorCode");

    public DeliveryReceipt parse(String provider, Map<String, Object> payload) {
        Map<String, Object> raw = payload != null ? payload : Map.of();
        String txn = findString(raw, ID_KEYS, 0);
        String ref = findString(raw, REF_KEYS, 0);
        String providerStatus = findString(raw, STATUS_KEYS, 0);
        String error = findString(raw, ERROR_KEYS, 0);
        return DeliveryReceipt.builder()
                .status(mapStatus(providerStatus))
                .transactionId(txn)
                .providerRef(ref)
                .providerStatus(providerStatus)
                .errorMessage(error)
                .raw(raw)
                .build();
    }

    /** Provider outcome word → our terminal status, or null for non-terminal words. */
    static String mapStatus(String providerStatus) {
        if (!StringUtils.hasText(providerStatus)) return null;
        String s = providerStatus.trim().toLowerCase(Locale.ROOT);
        if (s.contains("undeliv") || s.contains("fail") || s.contains("reject") || s.contains("expir") || s.contains("error")) {
            return "FAILED";
        }
        if (s.contains("bounce")) return "BOUNCED";
        if (s.contains("deliv") || s.contains("dlvrd")) return "DELIVERED";
        return null;   // sent / queued / accepted / read / unknown → not terminal
    }

    @SuppressWarnings("unchecked")
    private static String findString(Map<String, Object> map, List<String> keys, int depth) {
        if (map == null || depth > 3) return null;
        for (String k : keys) {
            Object v = map.get(k);
            if (v != null && !(v instanceof Map) && !(v instanceof List) && StringUtils.hasText(v.toString())) {
                return v.toString();
            }
        }
        for (Object v : map.values()) {
            if (v instanceof Map) {
                String found = findString((Map<String, Object>) v, keys, depth + 1);
                if (found != null) return found;
            } else if (v instanceof List) {
                for (Object o : (List<Object>) v) {
                    if (o instanceof Map) {
                        String found = findString((Map<String, Object>) o, keys, depth + 1);
                        if (found != null) return found;
                    }
                }
            }
        }
        return null;
    }
}
