package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.ChannelReadiness;
import org.egov.novubridge.service.account.MessageSendService;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The published HTTP contract of the admin and send APIs: routes, statuses and error codes. */
class TenantAccountControllersTest {

    private TenantAccountService accounts;
    private ChannelReadiness readiness;
    private MessageSendService sender;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        accounts = mock(TenantAccountService.class);
        readiness = mock(ChannelReadiness.class);
        sender = mock(MessageSendService.class);
        ProviderController providers = mock(ProviderController.class);
        mvc = MockMvcBuilders.standaloneSetup(new TenantAccountController(accounts, readiness, providers),
                new MessageController(sender)).build();
        when(accounts.enabled()).thenReturn(true);
    }

    private static Map<String, Object> state(String status) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("tenantId", "acme");
        s.put("status", status);
        s.put("provisioned", "PROVISIONED".equals(status));
        s.put("organizationId", "org-acme");
        return s;
    }

    @Test
    void provision_answersTheStateAndWhetherItCreatedTheOrganization() throws Exception {
        when(accounts.provision("acme")).thenReturn(new TenantAccountService.ProvisionResult(state("PROVISIONED"), true, List.of("digit-otp-sms")));
        mvc.perform(post("/novu-adapter/v1/tenants/acme/_provision"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PROVISIONED"))
                .andExpect(jsonPath("$.data.organizationCreated").value(true));
    }

    @Test
    void status_namesEveryChannelsReadiness() throws Exception {
        NovuAccount acme = new NovuAccount("acme", "org-acme", "env", "key");
        when(accounts.find("acme")).thenReturn(Optional.of(state("PROVISIONED")));
        when(accounts.requireAccount("acme")).thenReturn(acme);
        Map<String, ChannelReadiness.Readiness> channels = new LinkedHashMap<>();
        channels.put("SMS", new ChannelReadiness.Readiness("SMS", true, "jasmin-a", "jasmin", "jasmin", false, null));
        channels.put("EMAIL", new ChannelReadiness.Readiness("EMAIL", false, null, null, null, false, "no active EMAIL provider"));
        when(readiness.evaluateAll(acme, "acme")).thenReturn(channels);

        mvc.perform(get("/novu-adapter/v1/tenants/acme"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.provisioned").value(true))
                .andExpect(jsonPath("$.data.channels.SMS.ready").value(true))
                .andExpect(jsonPath("$.data.channels.SMS.provider").value("jasmin-a"))
                .andExpect(jsonPath("$.data.channels.EMAIL.ready").value(false));
    }

    @Test
    void status_ofAnUnknownTenant_isNotProvisioned_not404() throws Exception {
        when(accounts.find("globex")).thenReturn(Optional.empty());
        mvc.perform(get("/novu-adapter/v1/tenants/globex"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("NOT_PROVISIONED"))
                .andExpect(jsonPath("$.data.provisioned").value(false));
    }

    @Test
    void backfill_reportsEachTenant_andOneFailureDoesNotStopTheRest() throws Exception {
        when(accounts.provision("acme")).thenReturn(new TenantAccountService.ProvisionResult(state("PROVISIONED"), false, List.of()));
        when(accounts.provision("globex")).thenThrow(new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_NOVU_UNAVAILABLE", "down"));
        mvc.perform(post("/novu-adapter/v1/tenants/_backfill").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantIds\":[\"globex\",\"acme\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.failed").value(1))
                .andExpect(jsonPath("$.data[0].code").value("NB_NOVU_UNAVAILABLE"))
                .andExpect(jsonPath("$.data[1].status").value("PROVISIONED"));
    }

    @Test
    void send_mapsEachDocumentedFailureToItsStatusAndCode() throws Exception {
        String body = "{\"tenantId\":\"acme\",\"channel\":\"SMS\",\"recipient\":\"+254712345678\",\"templateKey\":\"OTP\","
                + "\"payload\":{\"code\":\"123456\",\"expiresInSeconds\":300}}";
        Object[][] cases = {
                {new AccountException(HttpStatus.CONFLICT, "NB_TENANT_NOT_PROVISIONED", "x"), 409},
                {new AccountException(HttpStatus.UNPROCESSABLE_ENTITY, "NB_NO_PROVIDER_FOR_CHANNEL", "x"), 422},
                {new AccountException(HttpStatus.BAD_GATEWAY, "NB_PROVIDER_FAILED", "x"), 502},
                {new CustomException("NB_TENANT_ACCOUNT_UNAVAILABLE", "x"), 503},
        };
        for (Object[] c : cases) {
            doThrow((RuntimeException) c[0]).when(sender).send(anyMap());
            String code = c[0] instanceof AccountException a ? a.code() : ((CustomException) c[0]).getCode();
            mvc.perform(post("/novu-adapter/v1/messages/_send").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().is((Integer) c[1]))
                    .andExpect(jsonPath("$.Errors[0].code").value(code));
        }
    }

    @Test
    void send_success_isTheOutcomesStatus() throws Exception {
        when(sender.send(anyMap())).thenReturn(new MessageSendService.Outcome(HttpStatus.ACCEPTED,
                Map.of("status", "QUEUED", "transactionId", "otp-1")));
        mvc.perform(post("/novu-adapter/v1/messages/_send").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.transactionId").value("otp-1"));
    }
}
