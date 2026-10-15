package org.egov.novubridge.service.account;

import org.egov.novubridge.service.NovuClient;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A new organization gets every workflow the bridge triggers; an existing one only what it lacks. */
class TenantWorkflowsTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org", "env", "key");

    private static NovuClient novuWith(List<Map<String, Object>> existing) {
        NovuClient novu = mock(NovuClient.class);
        when(novu.listWorkflows(ACME)).thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", Map.of("workflows", existing))).build());
        when(novu.createWorkflow(eq(ACME), any())).thenReturn(NovuClient.NovuResponse.builder().statusCode(201)
                .response(Map.of()).build());
        return novu;
    }

    private static TenantWorkflows workflows(NovuClient novu) {
        return new TenantWorkflows(novu, TenantAccountServiceTest.bridgeConfig(), TenantAccountServiceTest.accountsConfig());
    }

    @Test
    void onlyTheMissingWorkflowsAreCreated() {
        NovuClient novu = novuWith(List.of(Map.of("workflowId", "complaints-sms"), Map.of("workflowId", "digit-otp-sms")));

        List<String> created = workflows(novu).ensure(ACME);

        assertEquals(List.of("complaints-whatsapp", "complaints-email", "digit-otp-email"), created);
    }

    @Test
    void anOrganizationWithEveryWorkflow_isLeftAlone() {
        NovuClient novu = novuWith(List.of(Map.of("workflowId", "complaints-sms"), Map.of("workflowId", "complaints-whatsapp"),
                Map.of("workflowId", "complaints-email"), Map.of("workflowId", "digit-otp-sms"), Map.of("workflowId", "digit-otp-email")));

        assertTrue(workflows(novu).ensure(ACME).isEmpty());
        verify(novu, never()).createWorkflow(any(), any());
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void theOtpTemplate_carriesOnlyTheCodeAndItsExpiry_andTheNameIsTheId() {
        NovuClient novu = novuWith(List.of());
        workflows(novu).ensure(ACME);
        ArgumentCaptor<Map> workflow = ArgumentCaptor.forClass(Map.class);
        verify(novu, org.mockito.Mockito.times(5)).createWorkflow(eq(ACME), workflow.capture());
        Map<String, Object> otp = workflow.getAllValues().stream()
                .filter(w -> "digit-otp-sms".equals(w.get("workflowId"))).findFirst().orElseThrow();
        assertEquals("digit-otp-sms", otp.get("name"));
        String body = String.valueOf(((Map) ((Map) ((List) otp.get("steps")).get(0)).get("controlValues")).get("body"));
        assertEquals(List.of("payload.code", "payload.expiresInMinutes"), placeholders(body));
        assertFalse(body.contains("payload.body"));
    }

    @Test
    void aFailedCreate_failsTheEnsure() {
        NovuClient novu = novuWith(List.of());
        when(novu.createWorkflow(eq(ACME), any())).thenReturn(NovuClient.NovuResponse.builder().statusCode(422).build());
        assertEquals("NB_NOVU_WORKFLOW_CREATE_FAILED",
                assertThrows(AccountException.class, () -> workflows(novu).ensure(ACME)).code());
    }

    private static List<String> placeholders(String template) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\{\\{\\s*([^}\\s]+)\\s*}}").matcher(template);
        List<String> out = new java.util.ArrayList<>();
        while (m.find()) {
            out.add(m.group(1));
        }
        return out;
    }
}
