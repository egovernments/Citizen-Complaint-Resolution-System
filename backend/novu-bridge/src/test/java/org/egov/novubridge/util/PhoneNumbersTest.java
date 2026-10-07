package org.egov.novubridge.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PhoneNumbersTest {

    @Test
    void aKenyanNationalNumber_getsTheKenyanCode() {
        // Field finding: the citizen on a complaint APPLY reached Novu as 762061507.
        assertEquals("+254762061507", PhoneNumbers.toE164("762061507", "+254"));
        assertEquals("+254762061507", PhoneNumbers.toE164("0762061507", "+254"));
        assertEquals("+254762061507", PhoneNumbers.toE164("0762 061-507", "254"));
    }

    @Test
    void anIndianNationalNumber_getsTheIndianCode_evenWhenItStartsWith91() {
        assertEquals("+919415787824", PhoneNumbers.toE164("9415787824", "+91"));
        assertEquals("+919123456789", PhoneNumbers.toE164("9123456789", "+91"));
    }

    @Test
    void aNumberAlreadyInternational_isKept_whateverTheCode() {
        assertEquals("+254762061507", PhoneNumbers.toE164("+254762061507", "+91"));
        assertEquals("+254762061507", PhoneNumbers.toE164("+254 762 061 507", null));
        assertEquals("+254762061507", PhoneNumbers.toE164("00254762061507", null));
        assertEquals("+254762061507", PhoneNumbers.toE164("254762061507", "+254"), "carries its own 254 already");
        assertTrue(PhoneNumbers.isInternational("+254762061507"));
        assertTrue(PhoneNumbers.isInternational("00 254 762061507"));
        assertFalse(PhoneNumbers.isInternational("0762061507"));
    }

    @Test
    void aNationalNumberWithNoCode_isNull_neverAPlusInFrontOfIt() {
        // Field finding: a login OTP went out to +762061507 with the deployment code blank.
        assertNull(PhoneNumbers.toE164("762061507", null));
        assertNull(PhoneNumbers.toE164("762061507", ""));
        assertNull(PhoneNumbers.toE164("762061507", "  "));
        assertNull(PhoneNumbers.toE164("762061507", "+"), "a code with no digits is no code");
        assertNull(PhoneNumbers.toE164("762061507", "+25412"), "five digits is not a country code");
    }

    @Test
    void nothingToDial_isNull() {
        assertNull(PhoneNumbers.toE164(null, "+254"));
        assertNull(PhoneNumbers.toE164("  ", "+254"));
        assertNull(PhoneNumbers.toE164("n/a", "+254"));
        assertNull(PhoneNumbers.toE164("0", "+254"));
        assertNull(PhoneNumbers.toE164("00", "+254"));
    }

    @Test
    void dialDigits_acceptsTheUsualSpellings() {
        assertEquals("254", PhoneNumbers.dialDigits("+254"));
        assertEquals("254", PhoneNumbers.dialDigits("254"));
        assertEquals("254", PhoneNumbers.dialDigits("00254"));
        assertEquals("1", PhoneNumbers.dialDigits("+1"));
        assertNull(PhoneNumbers.dialDigits(null));
        assertNull(PhoneNumbers.dialDigits("+"));
    }
}
