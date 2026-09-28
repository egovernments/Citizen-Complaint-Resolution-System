package org.egov.identity.keycloak.phone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.egov.identity.keycloak.MutableClock;
import org.egov.identity.keycloak.config.OtpSettings;
import org.junit.jupiter.api.Test;

class TenantMobileValidationResolverTest {

    private final OtpSettings settings = OtpSettings.from(Map.of(
            "tenant-context-url", "http://identity-bff:3000/",
            "tenant-cache-seconds", "60")::get);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-09-28T00:00:00Z"));
    private final List<URI> calls = new ArrayList<>();

    private TenantMobileValidationResolver resolver(String body) {
        return new TenantMobileValidationResolver(settings, uri -> {
            calls.add(uri);
            return Optional.ofNullable(body);
        }, clock);
    }

    @Test
    void readsMobileValidationFromTheBrandingContract() {
        TenantMobileValidationResolver resolver = resolver(
                "{\"tenant\":{\"urlSlug\":\"bomet\"},\"mobileValidation\":{\"countryCode\":\"+254\","
                        + "\"mobileNumberRegex\":\"^[71][0-9]{8}$\",\"errorMessage\":\"ERR\"}}");
        MobileValidation v = resolver.resolve("bomet");
        assertEquals("+254", v.countryCode());
        assertEquals("^[71][0-9]{8}$", v.mobileNumberRegex());
        assertEquals("ERR", v.errorMessage());
        assertEquals(URI.create("http://identity-bff:3000/identity/v1/tenant-contexts/bomet/branding"), calls.get(0));
    }

    @Test
    void cachesPerTenantUntilTheTtl() {
        TenantMobileValidationResolver resolver = resolver(
                "{\"mobileValidation\":{\"countryCode\":\"+254\",\"mobileNumberRegex\":\"^[71][0-9]{8}$\"}}");
        resolver.resolve("bomet");
        resolver.resolve("bomet");
        assertEquals(1, calls.size());
        clock.advance(Duration.ofSeconds(61));
        resolver.resolve("bomet");
        assertEquals(2, calls.size());
    }

    @Test
    void fallsBackWhenTheTenantHasNoRuleOrTheBffFails() {
        assertEquals("+91", resolver("{\"mobileValidation\":null}").resolve("bomet").countryCode());
        assertEquals("+91", resolver(null).resolve("bomet").countryCode());
        assertEquals("+91", resolver("not json").resolve("bomet").countryCode());
        assertEquals("+91", resolver("{\"mobileValidation\":{\"countryCode\":\"+254\",\"mobileNumberRegex\":\"([\"}}")
                .resolve("bomet").countryCode());
        TenantMobileValidationResolver failing = new TenantMobileValidationResolver(settings, uri -> {
            throw new IOException("connection refused");
        }, clock);
        assertEquals("^[6-9][0-9]{9}$", failing.resolve("bomet").mobileNumberRegex());
    }

    @Test
    void neverCallsOutForAnUnsafeOrMissingSlug() {
        TenantMobileValidationResolver resolver = resolver("{}");
        resolver.resolve(null);
        resolver.resolve("../admin");
        resolver.resolve("Bomet");
        resolver.resolve("a");
        assertTrue(calls.isEmpty());
    }

    @Test
    void noLookupWhenNoBffIsConfigured() {
        TenantMobileValidationResolver resolver = new TenantMobileValidationResolver(OtpSettings.defaults(), uri -> {
            calls.add(uri);
            return Optional.empty();
        }, clock);
        assertEquals("+91", resolver.resolve("bomet").countryCode());
        assertTrue(calls.isEmpty());
    }
}
