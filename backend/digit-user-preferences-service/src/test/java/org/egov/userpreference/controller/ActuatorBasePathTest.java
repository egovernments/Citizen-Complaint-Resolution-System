package org.egov.userpreference.controller;

import org.egov.userpreference.repository.PreferenceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Actuator must not be mapped at the root, because there it takes
 * {@code /health} away from {@link HealthController}.
 *
 * <p>This is not hypothetical. Declaring {@code appType: java-spring} makes
 * the common Helm chart inject {@code MANAGEMENT_ENDPOINTS_WEB_BASE_PATH=/}
 * into the deployment, and an environment variable outranks
 * {@code application.properties}. At that base path actuator's health
 * endpoint answers {@code /health} ahead of the controller, so the probe gets
 * {@code {"status":"UP"}} instead of the documented
 * {@code components.database.status} shape, and liveness starts reflecting
 * {@code DataSourceHealthIndicator} rather than the repository check written
 * here. The chart pins the base path back to {@code /actuator}; this test
 * pins the two halves of that contract.
 */
class ActuatorBasePathTest {

    /** The shipped configuration: actuator away from the root. */
    @SpringBootTest
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    static class ShippedConfiguration {

        @Autowired
        private MockMvc mockMvc;

        @MockBean
        private PreferenceRepository preferenceRepository;

        @Test
        void servesTheControllersHealthShapeAtTheRoot() throws Exception {
            when(preferenceRepository.isReachable()).thenReturn(true);

            mockMvc.perform(get("/health"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("UP"))
                    .andExpect(jsonPath("$.components.database.status").value("UP"));
        }

        @Test
        void keepsActuatorOnItsOwnBasePath() throws Exception {
            when(preferenceRepository.isReachable()).thenReturn(true);

            mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
        }

        @Test
        void reportsTheDatabaseDownThroughTheRepositoryCheck() throws Exception {
            // Actuator's DataSourceHealthIndicator would still see a healthy
            // H2 pool here, so a 503 proves the controller answered.
            when(preferenceRepository.isReachable()).thenReturn(false);

            mockMvc.perform(get("/health"))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.components.database.status").value("DOWN"));
        }
    }

    /**
     * What the chart would produce without its override, kept as the
     * demonstration of why that override exists.
     */
    @SpringBootTest
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    @TestPropertySource(properties = "management.endpoints.web.base-path=/")
    static class ActuatorAtRoot {

        @Autowired
        private MockMvc mockMvc;

        @MockBean
        private PreferenceRepository preferenceRepository;

        @Test
        void actuatorTakesOverHealthAndDropsTheDatabaseComponent() throws Exception {
            when(preferenceRepository.isReachable()).thenReturn(false);

            // The controller would answer 503 with components.database.status;
            // actuator answers 200 without it. Asserting the wrong shape here
            // is deliberate: if this ever starts matching the controller, the
            // chart override has become unnecessary and can go.
            mockMvc.perform(get("/health"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.components.database").doesNotExist());
        }
    }
}
