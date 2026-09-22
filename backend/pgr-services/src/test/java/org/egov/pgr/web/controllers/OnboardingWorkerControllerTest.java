package org.egov.pgr.web.controllers;

import org.egov.pgr.onboarding.OnboardingWorkerService;
import org.egov.tracer.model.CustomException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@RunWith(MockitoJUnitRunner.class)
public class OnboardingWorkerControllerTest {

    @Mock private OnboardingWorkerService service;

    private MockMvc mvc(String token) {
        return MockMvcBuilders.standaloneSetup(new OnboardingWorkerController(service, token)).build();
    }

    @Test
    public void workerRoutesRequireTheDedicatedWorkerCredential() throws Exception {
        mvc("worker-secret").perform(post("/v2/onboarding/internal/operations/_claim")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"workerId\":\"w\"}"))
                .andExpect(status().isUnauthorized());
        mvc("worker-secret").perform(post("/v2/onboarding/internal/operations/_claim")
                        .header("Authorization", "Bearer introspection-secret")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"workerId\":\"w\"}"))
                .andExpect(status().isUnauthorized());
        mvc("").perform(post("/v2/onboarding/internal/operations/_claim")
                        .header("Authorization", "Bearer anything")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"workerId\":\"w\"}"))
                .andExpect(status().isServiceUnavailable());
        verifyNoInteractions(service);
    }

    @Test
    public void claimReturnsNoContentWhenIdle() throws Exception {
        when(service.claim(eq("w"), anyLong())).thenReturn(Optional.empty());
        mvc("worker-secret").perform(post("/v2/onboarding/internal/operations/_claim")
                        .header("Authorization", "Bearer worker-secret")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"workerId\":\"w\",\"leaseSeconds\":60}"))
                .andExpect(status().isNoContent());
    }

    @Test
    public void lostLeaseIsAConflict() throws Exception {
        UUID id = UUID.randomUUID();
        UUID lease = UUID.randomUUID();
        doThrow(new CustomException("ONBOARDING_LEASE_LOST", "lost"))
                .when(service).complete(eq(id), eq(lease), any());
        mvc("worker-secret").perform(post("/v2/onboarding/internal/operations/_complete")
                        .header("Authorization", "Bearer worker-secret")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"" + id + "\",\"leaseToken\":\"" + lease + "\",\"completedSteps\":[]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.Errors[0].code").value("ONBOARDING_LEASE_LOST"));
    }
}
