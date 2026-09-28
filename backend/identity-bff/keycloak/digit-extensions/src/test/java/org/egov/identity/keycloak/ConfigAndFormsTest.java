package org.egov.identity.keycloak;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import java.util.Map;
import org.egov.identity.keycloak.config.OtpSettings;
import org.egov.identity.keycloak.forms.DigitLoginFormsProvider;
import org.junit.jupiter.api.Test;

class ConfigAndFormsTest {

    @Test
    void contractDefaults() {
        OtpSettings s = OtpSettings.defaults();
        assertEquals(6, s.otpLength());
        assertEquals(Duration.ofSeconds(300), s.otpTtl());
        assertEquals(Duration.ofSeconds(30), s.resendInterval());
        assertEquals(5, s.maxAttempts());
        assertEquals(5, s.phoneSendsPerHour());
        assertEquals(20, s.ipSendsPerHour());
        assertEquals("", s.tenantContextUrl());
    }

    @Test
    void rejectsNonsenseConfig() {
        assertThrows(IllegalArgumentException.class, () -> OtpSettings.from(Map.of("otp-length", "2")::get));
        assertThrows(IllegalArgumentException.class, () -> OtpSettings.from(Map.of("max-attempts", "x")::get));
        assertThrows(IllegalArgumentException.class, () -> OtpSettings.from(Map.of("default-country-code", "254")::get));
        assertThrows(IllegalArgumentException.class, () -> OtpSettings.from(Map.of("default-mobile-regex", "([")::get));
    }

    @Test
    void tenantAttributeOnlyCarriesPlainSlugs() {
        assertEquals("bomet", DigitLoginFormsProvider.validSlug("bomet"));
        assertEquals("ke-nairobi-2", DigitLoginFormsProvider.validSlug("ke-nairobi-2"));
        assertNull(DigitLoginFormsProvider.validSlug("Bomet"));
        assertNull(DigitLoginFormsProvider.validSlug("<script>"));
        assertNull(DigitLoginFormsProvider.validSlug("a"));
        assertNull(DigitLoginFormsProvider.validSlug(null));
    }
}
