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
    }
}
