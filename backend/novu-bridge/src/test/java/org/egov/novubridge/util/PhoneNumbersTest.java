package org.egov.novubridge.util;

import org.junit.jupiter.api.Test;

import java.util.regex.Pattern;

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
    void aTrunkMarkerInBrackets_isNotDialled() {
        // Review of #2342: "+254 (0) 712345678" went to +2540712345678.
        assertEquals("+254712345678", PhoneNumbers.toE164("+254 (0) 712345678", null));
        assertEquals("+442079460958", PhoneNumbers.toE164("+44 (0)20 7946 0958", "+91"));
        assertEquals("+254712345678", PhoneNumbers.toE164("(0) 712 345 678", "+254"));
        assertTrue(PhoneNumbers.isInternational("+254 (0) 712345678"));
        assertEquals("+254712345678", PhoneNumbers.toE164("0712345678", "+254"), "a bare trunk 0 as before");
    }

    @Test
    void theTenantsPattern_decidesWhetherTheCodeIsThere_whenExactlyOneReadingMatches() {
        Pattern india = Pattern.compile("^[6-9][0-9]{9}$");
        assertEquals("+919123456789", PhoneNumbers.toE164("9123456789", "+91", india));
        assertEquals("+919876543210", PhoneNumbers.toE164("919876543210", "+91", india));
        // 8-digit national numbers: the 9-digit heuristic alone would prefix 65 twice.
        Pattern singapore = Pattern.compile("^[89][0-9]{7}$");
        assertEquals("+6581234567", PhoneNumbers.toE164("6581234567", "+65", singapore));
        assertEquals("+656581234567", PhoneNumbers.toE164("6581234567", "+65"), "the heuristic's misreading");
        // A long national number that starts with the code (German area code 491).
        Pattern germany = Pattern.compile("^[1-9][0-9]{9,10}$");
        assertEquals("+4949112345678", PhoneNumbers.toE164("49112345678", "+49", germany));
        assertEquals("+49112345678", PhoneNumbers.toE164("49112345678", "+49"), "the documented limitation");
    }

    @Test
    void bothReadingsOrNeitherMatching_leaveTheHeuristic() {
        Pattern loose = Pattern.compile("^[0-9]+$");
        assertEquals("+254712345678", PhoneNumbers.toE164("254712345678", "+254", loose));
        Pattern kenya = Pattern.compile("^[17][0-9]{8}$");
        assertEquals("+2542541", PhoneNumbers.toE164("2541", "+254", kenya), "neither: the heuristic, as before");
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
