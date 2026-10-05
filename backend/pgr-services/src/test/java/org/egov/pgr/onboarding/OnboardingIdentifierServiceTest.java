package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertEquals;
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
}
