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
    // Field finding (dev deployment, 2026-10-07): on the Logs API the citizen's uuid came back
    // as it is while the assignee's was masked like a phone, because its last segment held a
    // 7-digit run. Ids are ids: neither is masked, alone or embedded.
    @Test
    void aUuidHoldingASevenDigitRun_isAnIdNotAPhone() {
        String citizen = "2f9a1c34-5b6d-4e7f-8a90-ab12cd34ef56";
        String assignee = "0b7e5a10-3c2d-4f1e-9a8b-d1234966d08b";   // "1234966": 7 digits
        assertEquals(citizen, PiiMask.mask(citizen));
        assertEquals(assignee, PiiMask.mask(assignee));
        assertEquals("PG-PGR-1:ASSIGN:PENDINGATLME:" + assignee + ":SMS",
                PiiMask.maskEmbedded("PG-PGR-1:ASSIGN:PENDINGATLME:" + assignee + ":SMS"));
        assertEquals(java.util.Map.of("subscriberId", assignee),
                PiiMask.maskDeep(java.util.Map.of("subscriberId", assignee)));
    }

    @Test
    void aUuidOfDigitsOnly_isStillAnId_butAPhoneNextToItIsMasked() {
        String digitsOnly = "12345678-1234-1234-1234-123456789012";
        assertEquals(digitsOnly + ":***678", PiiMask.maskEmbedded(digitsOnly + ":0712345678"));
        assertEquals("ke:+***678", PiiMask.mask("ke:+254712345678"));
        assertEquals("+***678", PiiMask.mask("+254712345678"));
    }

    @Test
    void aHexTokenLongerThanAUuid_isNotTreatedAsOne() {
        // 13 hex chars in the last group: not a canonical UUID, so its digit run is masked.
        assertEquals("0b7e5a10-3c2d-4f1e-9a8b-d***660d08b",
                PiiMask.mask("0b7e5a10-3c2d-4f1e-9a8b-d12349660d08b"));
    }
}
