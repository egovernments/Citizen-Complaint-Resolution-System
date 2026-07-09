package org.egov.novubridge.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class PiiMaskTest {

    @Test
    void phoneBearingSubscriberId_masksToLastThreeDigits() {
        assertEquals("tenant.city:***678", PiiMask.mask("tenant.city:0712345678"));
    }

    @Test
    void uuidSubscriberId_passesThroughUntouched() {
        String uuid = "tenant.city:2f9a1c34-5b6d-4e7f-8a90-1234ab567cd8";
        assertEquals(uuid, PiiMask.mask(uuid));
    }

    @Test
    void email_keepsFirstCharAndDomain() {
        assertEquals("c***@example.org", PiiMask.mask("contact@example.org"));
    }

    @Test
    void maskEmbedded_masksPhoneSegmentInTransactionId() {
        String txn = "CMP-2026-1:APPLY:PENDING:tenant.city:0712345678:SMS";
        assertEquals("CMP-2026-1:APPLY:PENDING:tenant.city:***678:SMS", PiiMask.maskEmbedded(txn));
    }

    @Test
    void nullValue_returnsNull() {
        assertNull(PiiMask.mask(null));
        assertNull(PiiMask.maskEmbedded(null));
        assertNull(PiiMask.maskDeep(null));
    }

    @Test
    void maskDeep_masksNestedStringsOnly_keepsScalarsAndInput() {
        java.util.Map<String, Object> nested = new java.util.LinkedHashMap<>();
        nested.put("transactionId", "CMP-1:APPLY:PENDING:tenant.city:0712345678:SMS");
        nested.put("emails", java.util.List.of("contact@example.org"));
        java.util.Map<String, Object> in = new java.util.LinkedHashMap<>();
        in.put("data", nested);
        in.put("novuStatus", 201);
        in.put("test", true);
        in.put("nothing", null);

        java.util.Map<String, Object> out = PiiMask.maskDeep(in);

        java.util.Map<?, ?> outNested = (java.util.Map<?, ?>) out.get("data");
        assertEquals("CMP-1:APPLY:PENDING:tenant.city:***678:SMS", outNested.get("transactionId"));
        assertEquals(java.util.List.of("c***@example.org"), outNested.get("emails"));
        // Non-string leaves keep their exact values.
        assertEquals(201, out.get("novuStatus"));
        assertEquals(true, out.get("test"));
        assertNull(out.get("nothing"));
        // Input structure is never mutated (read-time projection safety).
        assertEquals("CMP-1:APPLY:PENDING:tenant.city:0712345678:SMS", nested.get("transactionId"));
    }
}
