package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class MaskingStrategyTest {

    @Test
    void redactReturnsNull() {
        assertNull(MaskingStrategy.apply("9998887766", Map.of("strategy", "REDACT")));
    }

    @Test
    void maskShowLastNKeepsOnlyTheLastNCharacters() {
        Object result = MaskingStrategy.apply("9998887766", Map.of("strategy", "MASK_SHOW_LAST_N", "n", 2));
        assertEquals("XXXXXXXX66", result);
    }

    @Test
    void maskShowLastNUsesTheConfiguredMaskChar() {
        Object result = MaskingStrategy.apply("9998887766", Map.of("strategy", "MASK_SHOW_LAST_N", "n", 2, "maskChar", "*"));
        assertEquals("********66", result);
    }

    @Test
    void maskShowLastNClampsNToTheStringLength() {
        Object result = MaskingStrategy.apply("123", Map.of("strategy", "MASK_SHOW_LAST_N", "n", 10));
        assertEquals("123", result);
    }

    @Test
    void nullValueStaysNullRegardlessOfStrategy() {
        assertNull(MaskingStrategy.apply(null, Map.of("strategy", "MASK_SHOW_LAST_N", "n", 2)));
    }

    @Test
    void unrecognizedStrategyFailsClosedToRedact() {
        assertNull(MaskingStrategy.apply("9998887766", Map.of("strategy", "NOT_A_REAL_STRATEGY")));
    }

    @Test
    void missingStrategyFailsClosedToRedact() {
        assertNull(MaskingStrategy.apply("9998887766", Map.of()));
    }
}
