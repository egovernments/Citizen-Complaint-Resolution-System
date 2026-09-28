package org.egov.userpreference.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StringUtilTest {

    @Test
    void treatsNullAndTheEmptyStringAlikeAsGoDid() {
        assertTrue(StringUtil.isEmpty(null));
        assertTrue(StringUtil.isEmpty(""));
        assertFalse(StringUtil.isEmpty(" "));
        assertFalse(StringUtil.isEmpty("x"));

        assertFalse(StringUtil.isNotEmpty(null));
        assertFalse(StringUtil.isNotEmpty(""));
        assertTrue(StringUtil.isNotEmpty(" "));
    }

    @Test
    void trimsAndMapsAnAbsentValueOntoTheEmptyString() {
        assertEquals("", StringUtil.trimToEmpty(null));
        assertEquals("", StringUtil.trimToEmpty("   "));
        assertEquals("x", StringUtil.trimToEmpty("  x  "));
        assertEquals("a b", StringUtil.trimToEmpty("  a b  "));
    }

    @Test
    void leavesAValuePreciselyAloneWhenOnlyNullNeedsMapping() {
        assertEquals("", StringUtil.nullToEmpty(null));
        assertEquals("  x  ", StringUtil.nullToEmpty("  x  "));
    }

    @Test
    void countsAnAbsentValueAsZeroLength() {
        assertEquals(0, StringUtil.length(null));
        assertEquals(0, StringUtil.length(""));
        assertEquals(3, StringUtil.length("abc"));
    }
}
