package org.egov.userpreference.config;

import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The tunables that used to be hard-coded in Java are configuration now, and
 * the defaults still come from the real {@code application.properties} rather
 * than from a copy in the test resources.
 */
class ConfigurableDefaultsTest {

    /** The shipped defaults, loaded from src/main/resources/application.properties. */
    static class Defaults extends ApiTestBase {

        @Autowired
        private ApplicationConfig applicationConfig;

        @Test
        void carriesTheGoServicesOriginalPagingAndLanguageDefaults() {
            assertEquals(10, applicationConfig.getDefaultLimit());
            assertEquals(0, applicationConfig.getDefaultOffset());
            assertEquals(100, applicationConfig.getMaxLimit());
            assertEquals("en_IN, hi_IN, fr_IN, pt_IN", applicationConfig.getValidLanguagesMessage());
        }

        @Test
        void rejectsALanguageOutsideTheConfiguredSet() throws Exception {
            upsert(payloadWith("ta_IN"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.Errors[0].code").value("INVALID_LANGUAGE"))
                    .andExpect(jsonPath("$.Errors[0].message")
                            .value("preferredLanguage must be one of: en_IN, hi_IN, fr_IN, pt_IN; got: ta_IN"));
        }
    }

    /** A tenant whose MDMS StateInfo offers a locale the shipped list omits. */
    @TestPropertySource(properties = "user.preference.valid-languages=en_IN,ka_IN")
    static class TenantOverride extends ApiTestBase {

        @Test
        void acceptsALocaleTheTenantAdded() throws Exception {
            upsert(payloadWith("ka_IN")).andExpect(status().isOk());
        }

        @Test
        void stillRejectsOneOutsideTheOverriddenSet() throws Exception {
            upsert(payloadWith("hi_IN"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.Errors[0].message")
                            .value("preferredLanguage must be one of: en_IN, ka_IN; got: hi_IN"));
        }
    }

    /** An empty list turns the check off for a tenant with a wide language set. */
    @TestPropertySource(properties = "user.preference.valid-languages=")
    static class CheckDisabled extends ApiTestBase {

        @Test
        void acceptsAnyLocale() throws Exception {
            upsert(payloadWith("qq_ZZ")).andExpect(status().isOk());
        }
    }

    /** The page ceiling is configuration, not a constant. */
    @TestPropertySource(properties = "user.preference.search.max-limit=7")
    static class MaxLimitOverride extends ApiTestBase {

        @Test
        void clampsToTheConfiguredCeiling() throws Exception {
            search("""
                    { "RequestInfo": {}, "criteria": { "userId": "nobody", "limit": 100000 } }
                    """)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.pagination.limit").value(7));
        }
    }

    private static String payloadWith(String language) {
        return """
                {
                  "RequestInfo": {},
                  "preference": {
                    "userId": "lang-user",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "%s" }
                  }
                }
                """.formatted(language);
    }
}
