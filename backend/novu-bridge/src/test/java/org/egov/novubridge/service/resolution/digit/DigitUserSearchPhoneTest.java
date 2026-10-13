package org.egov.novubridge.service.resolution.digit;

import org.egov.novubridge.service.resolution.Recipient;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** A hydrated user's own egov-user countryCode makes their number E.164; without one it stays national. */
class DigitUserSearchPhoneTest {

    @Test
    void theUsersOwnCountryCode_isApplied_inEverySpelling() {
        assertEquals("+254762061507", DigitUserSearch.withCountryCode("762061507", "+254"));
        assertEquals("+254762061507", DigitUserSearch.withCountryCode("0762061507", "+254"), "trunk 0 dropped");
        assertEquals("+254762061507", DigitUserSearch.withCountryCode("762061507", "254"));
        assertEquals("+919415787824", DigitUserSearch.withCountryCode("9415787824", "+91"));
    }

    @Test
    void anInternationalNumber_isKept() {
        assertEquals("+254762061507", DigitUserSearch.withCountryCode("+254762061507", "+91"));
        assertEquals("+254762061507", DigitUserSearch.withCountryCode("+254 762 061 507", null));
    }

    @Test
    void withoutACountryCode_theNationalNumberIsKept_forThePipelineToComplete() {
        assertEquals("762061507", DigitUserSearch.withCountryCode("762061507", null));
        assertEquals("762061507", DigitUserSearch.withCountryCode(" 762061507 ", ""));
        assertNull(DigitUserSearch.withCountryCode(" ", "+254"));
    }

    @Test
    void toRecipient_usesIt() {
        Recipient r = DigitUserSearch.toRecipient(Map.of("uuid", "u-1", "name", "Lme",
                "mobileNumber", "0762061507", "countryCode", "+254"), "PGR_LME");
        assertEquals("+254762061507", r.phone());
    }
}
