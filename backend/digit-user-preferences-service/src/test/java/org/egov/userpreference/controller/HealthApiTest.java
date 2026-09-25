package org.egov.userpreference.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The health probe, served by actuator at the container root.
 *
 * <p>There is no hand-written controller behind this. Actuator is mapped at
 * {@code /} (which is also what the common Helm chart injects for
 * {@code appType: java-spring}), and {@code DatabaseHealthIndicator} supplies
 * the single {@code database} component, so the response is the same shape
 * the Go service published. These tests pin that shape, because the compose
 * healthcheck, both Kubernetes probes and both Gatus catalogues all read
 * exactly this path.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HealthApiTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private org.egov.userpreference.repository.PreferenceRepository preferenceRepository;

    @Test
    void reportsUpWhileTheDatabaseAnswers() throws Exception {
        when(preferenceRepository.isReachable()).thenReturn(true);

        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components.database.status").value("UP"));
    }

    @Test
    void reportsServiceUnavailableWhenTheDatabaseIsUnreachable() throws Exception {
        when(preferenceRepository.isReachable()).thenReturn(false);

        mockMvc.perform(get("/health"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status").value("DOWN"))
                .andExpect(jsonPath("$.components.database.status").value("DOWN"));
    }

    @Test
    void reportsOnlyTheDatabaseComponent() throws Exception {
        // diskSpace and ping are disabled, and the built-in `db` indicator is
        // replaced, so nothing appears beside `database`.
        when(preferenceRepository.isReachable()).thenReturn(true);

        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.components.db").doesNotExist())
                .andExpect(jsonPath("$.components.diskSpace").doesNotExist())
                .andExpect(jsonPath("$.components.ping").doesNotExist());
    }

    @Test
    void doesNotLeakComponentDetails() throws Exception {
        // show-details=never, so a component carries a status and nothing else.
        when(preferenceRepository.isReachable()).thenReturn(true);

        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.components.database.details").doesNotExist());
    }

    @Test
    void doesNotServeHealthUnderTheApiContextPath() throws Exception {
        when(preferenceRepository.isReachable()).thenReturn(true);

        mockMvc.perform(get("/user-preference/health")).andExpect(status().isNotFound());
    }
}
