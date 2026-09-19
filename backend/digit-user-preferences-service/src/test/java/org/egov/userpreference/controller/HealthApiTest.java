package org.egov.userpreference.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The health probe, which lives at the container root rather than under the
 * API context path. The compose healthcheck, both Kubernetes probes and both
 * Gatus catalogues all point at exactly {@code /health}.
 */
@SpringBootTest
@AutoConfigureMockMvc
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
    void doesNotServeHealthUnderTheApiContextPath() throws Exception {
        when(preferenceRepository.isReachable()).thenReturn(true);

        mockMvc.perform(get("/user-preference/health"))
                .andExpect(status().isNotFound());
    }
}
