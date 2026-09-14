package org.egov.pgr.web.controllers;

import org.egov.pgr.onboarding.IdentitySessionClient;
import org.egov.pgr.onboarding.OnboardingOperation;
import org.egov.pgr.onboarding.OnboardingPrincipal;
import org.egov.pgr.onboarding.OnboardingService;
import org.egov.pgr.onboarding.OnboardingSignup;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@RunWith(MockitoJUnitRunner.class)
public class OnboardingApiControllerTest {

    @Mock private IdentitySessionClient identitySessionClient;
    @Mock private OnboardingService service;
    private MockMvc mockMvc;
    private OnboardingPrincipal principal;

    @Before
    public void setUp() {
        principal = new OnboardingPrincipal("https://issuer", "subject-1", "person@example.com", "Person");
        when(identitySessionClient.introspect("digit_identity_session=session-1")).thenReturn(principal);
        mockMvc = MockMvcBuilders.standaloneSetup(
                new OnboardingApiController(identitySessionClient, service)).build();
    }

    @Test
    public void createUsesBffIdentityAndReturnsDraft() throws Exception {
        OnboardingSignup signup = OnboardingSignup.builder().id(UUID.randomUUID()).status("DRAFT").build();
        when(service.create(eq(principal), any(), eq("create-1"))).thenReturn(signup);

        mockMvc.perform(post("/v2/onboarding/signups/_create")
                        .header("Cookie", "digit_identity_session=session-1")
                        .header("Idempotency-Key", "create-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"Signup\":{\"accountName\":\"Bomet\"}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.Signup.status").value("DRAFT"));
    }

    @Test
    public void updateSearchAndIdentifierRoutesAreLive() throws Exception {
        UUID id = UUID.randomUUID();
        when(service.update(eq(principal), any())).thenReturn(
                OnboardingSignup.builder().id(id).status("DRAFT").build());
        when(service.search(eq(principal), any())).thenReturn(Collections.emptyList());
        when(service.checkIdentifier(eq(principal), any())).thenReturn(
                Collections.singletonMap("available", true));

        request("/v2/onboarding/signups/_update", "{\"Signup\":{\"id\":\"" + id + "\"}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.Signup.id").value(id.toString()));
        request("/v2/onboarding/signups/_search", "{}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.Signups").isArray());
        request("/v2/onboarding/identifiers/_check", "{\"Identifier\":{\"type\":\"URL_SLUG\",\"value\":\"bomet\"}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.Identifier.available").value(true));
    }

    @Test
    public void submitAndOperationRoutesAreLive() throws Exception {
        UUID signupId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        OnboardingOperation operation = OnboardingOperation.builder()
                .id(operationId).signupId(signupId).status("PENDING").attempt(1).build();
        when(service.submit(eq(principal), any(), eq("submit-1"))).thenReturn(operation);
        when(service.searchOperations(eq(principal), any())).thenReturn(Collections.singletonList(operation));
        when(service.retry(eq(principal), any())).thenReturn(operation.toBuilder().attempt(2).build());

        mockMvc.perform(post("/v2/onboarding/signups/_submit")
                        .header("Cookie", "digit_identity_session=session-1")
                        .header("Idempotency-Key", "submit-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"Signup\":{\"id\":\"" + signupId + "\"}}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.Operation.id").value(operationId.toString()));
        request("/v2/onboarding/operations/_search", "{\"Operation\":{\"id\":\"" + operationId + "\"}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.Operations[0].status").value("PENDING"));
        request("/v2/onboarding/operations/_retry", "{\"Operation\":{\"id\":\"" + operationId + "\"}}")
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.Operation.attempt").value(2));
    }

    private org.springframework.test.web.servlet.ResultActions request(String path, String body) throws Exception {
        return mockMvc.perform(post(path)
                .header("Cookie", "digit_identity_session=session-1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }
}
