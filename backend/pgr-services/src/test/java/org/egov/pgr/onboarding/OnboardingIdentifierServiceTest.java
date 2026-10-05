package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.junit.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.Arrays;
import java.util.Set;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

/** URL slug rules, identity-bff docs section 2.4.1. */
public class OnboardingIdentifierServiceTest {

    private final OnboardingIdentifierService identifiers = new OnboardingIdentifierService();

    @Test
    public void rejectsReservedRouteWordsAsSlugAndAlias() {
        for (String slug : Arrays.asList("citizen", "employee", "user", "pgr-services", "mdms-v2", "novu",
                "grafana", "keycloak", "filestore", "configurator", "identity", "digit-ui")) {
            assertThrows(slug, CustomException.class, () -> identifiers.urlSlug(slug, "Signup.urlSlug"));
            assertThrows(slug, CustomException.class, () -> identifiers.forInput("URL_SLUG", slug));
            assertThrows(slug, CustomException.class, () -> identifiers.forInput("ORGANIZATION_ALIAS", slug));
        }
    }

    @Test
    public void reservedCheckAppliesAfterLowerCasing() {
        assertThrows(CustomException.class, () -> identifiers.urlSlug("Citizen", "Signup.urlSlug"));
    }

    @Test
    public void requiresTwoLetters() {
        for (String slug : Arrays.asList("a1", "a-123", "12")) {
            assertThrows(slug, CustomException.class, () -> identifiers.urlSlug(slug, "Signup.urlSlug"));
        }
    }

    @Test
    public void acceptsOrdinarySlugs() {
        assertEquals("bomet-county", identifiers.urlSlug("Bomet-County", "Signup.urlSlug"));
        assertEquals("ke", identifiers.urlSlug("ke", "Signup.urlSlug"));
        // A reserved word inside a longer slug is fine; only the whole segment collides.
        assertEquals("citizen-voice", identifiers.urlSlug("citizen-voice", "Signup.urlSlug"));
        assertTrue(OnboardingIdentifierService.RESERVED_URL_SLUGS.size() > 10);
    }

    /** #2269 round-3 review item 1: `default` always; state roots from the deployment's own settings. */
    @Test
    public void reservesDefaultAndTheConfiguredStateRoots() {
        assertTrue(identifiers.reservedTenantId("default"));
        assertTrue(identifiers.reservedTenantId("DEFAULT"));
        assertFalse(identifiers.reservedTenantId("bometcounty"));

        MockEnvironment env = new MockEnvironment()
                .withProperty("pgr.onboarding.reserved-tenant-ids", "pg, mz")
                .withProperty("state.level.tenant.id", "ke.nairobi")
                .withProperty("egov.state.level.tenant.id", "ke")
                .withProperty("pgr.onboarding.provisioner.tenant-id", "et");
        OnboardingIdentifierService configured = new OnboardingIdentifierService(env);
        assertEquals(Set.of("default", "pg", "mz", "ke", "et"), configured.reservedTenantIds());
        assertFalse("a city id is not a root tenant id", configured.reservedTenantId("nairobi"));

        // Unset properties leave only the platform tenant.
        assertEquals(Set.of("default"), new OnboardingIdentifierService(new MockEnvironment()).reservedTenantIds());
    }

    @Test
    public void reservedTenantIdsShipWithTheReferenceRoot() throws Exception {
        java.util.Properties properties = new java.util.Properties();
        try (var input = new org.springframework.core.io.ClassPathResource("application.properties").getInputStream()) {
            properties.load(input);
        }
        assertEquals("${PGR_ONBOARDING_RESERVED_TENANT_IDS:pg}", properties.getProperty("pgr.onboarding.reserved-tenant-ids"));
    }
}
