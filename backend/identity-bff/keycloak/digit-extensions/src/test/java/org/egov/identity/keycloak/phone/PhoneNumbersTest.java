package org.egov.identity.keycloak.phone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

class PhoneNumbersTest {

    // Kenya as seeded for Bomet/Nairobi: +254 with a 9-digit national number.
    private final MobileValidation kenya = MobileValidation.of("+254", "^[71][0-9]{8}$", null);
    private final MobileValidation india = MobileValidation.of("+91", "^[6-9][0-9]{9}$", null);

    @ParameterizedTest
    @ValueSource(strings = {"712345678", "0712345678", "0712 345 678", "254712345678", "+254712345678",
            "+254 712-345-678", "00254712345678", " (0712) 345678 "})
    void acceptsLocalAndInternationalFormsOfOneNumber(String input) {
        assertEquals(Optional.of("+254712345678"), PhoneNumbers.normalize(input, kenya));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "812345678", "71234567", "7123456789", "+255712345678", "+91712345678",
            "71234567a", "+", "0", "712345678712345678712345678712345678"})
    void rejectsNumbersOutsideTheTenantRule(String input) {
        assertEquals(Optional.empty(), PhoneNumbers.normalize(input, kenya));
    }

    @Test
    void rejectsNull() {
        assertEquals(Optional.empty(), PhoneNumbers.normalize(null, kenya));
        assertEquals(Optional.empty(), PhoneNumbers.normalize("712345678", null));
    }

    @Test
    void followsTheTenantNotAFixedCountry() {
        assertEquals(Optional.of("+919876543210"), PhoneNumbers.normalize("9876543210", india));
        assertEquals(Optional.of("+919876543210"), PhoneNumbers.normalize("+91 98765 43210", india));
        assertEquals(Optional.empty(), PhoneNumbers.normalize("5876543210", india));
    }

    @Test
    void resultIsAlwaysE164() {
        String e164 = PhoneNumbers.normalize("0712345678", kenya).orElseThrow();
        assertTrue(PhoneNumbers.E164.matcher(e164).matches());
    }

    @Test
    void masksAllButTheLastThreeDigits() {
        assertEquals("+254 ••••••678", PhoneNumbers.mask("+254712345678", "+254"));
        assertEquals("•••••••••678", PhoneNumbers.mask("+254712345678", "+1"));
    }

    @Test
    void mobileValidationRejectsUnusableRules() {
        assertNull(MobileValidation.of(null, "^[0-9]+$", null));
        assertNull(MobileValidation.of("+254", "([", null));
        assertNull(MobileValidation.of("Kenya", "^[0-9]+$", null));
        assertNull(MobileValidation.of("+254", "", null));
        assertEquals("+254", MobileValidation.of("254", "^[0-9]{9}$", null).countryCode());
    }
}
