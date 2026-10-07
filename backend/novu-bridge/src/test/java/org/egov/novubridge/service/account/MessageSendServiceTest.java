package org.egov.novubridge.service.account;

import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** messages/_send: the tenant's own account, and three distinct, documented failures. */
class MessageSendServiceTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme", "key-acme");

    private TenantAccountService tenantAccounts;
    private ChannelReadiness readiness;
    private NovuClient novu;
    private DispatchLogRepository ledger;
    private MessageSendService service;
    private Map<String, Object> notification;

    @BeforeEach
    void setUp() {
        tenantAccounts = mock(TenantAccountService.class);
        when(tenantAccounts.enabled()).thenReturn(true);
        readiness = mock(ChannelReadiness.class);
        novu = mock(NovuClient.class);
        ledger = mock(DispatchLogRepository.class);
        TenantAccountsConfiguration accounts = TenantAccountServiceTest.accountsConfig();
        accounts.setConfirmTimeoutMs(1000L);
        accounts.setConfirmPollMs(100L);
        service = new MessageSendService(tenantAccounts, readiness, novu, accounts, ledger);
        long[] now = {1_700_000_000_000L};
        service.clock = () -> now[0];
        service.sleeper = ms -> now[0] += ms;

        when(tenantAccounts.accountFor("acme.city")).thenReturn(ACME);
        when(readiness.evaluate(ACME, "acme.city", "SMS")).thenReturn(new ChannelReadiness.Readiness(
                "SMS", true, "jasmin-acme", "jasmin", "jasmin", false, null));
        when(novu.trigger(any(NovuAccount.class), anyString(), anyString(), any(), any(), anyMap(), anyString(), any()))
                .thenAnswer(inv -> {
                    String txn = inv.getArgument(6);
                    return NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("data",
                            Map.<String, Object>of("acknowledged", true, "transactionId", txn))).build();
                });
        notification = new HashMap<>(Map.of("transactionId", "placeholder", "jobs",
                List.of(Map.of("type", "sms", "status", "completed"))));
        when(novu.notificationsByTransaction(any(NovuAccount.class), anyString())).thenAnswer(inv -> {
            Map<String, Object> n = new HashMap<>(notification);
            n.put("transactionId", inv.getArgument(1));
            return NovuClient.NovuResponse.builder().statusCode(200).response(Map.of("data", List.of(n))).build();
        });
    }

    private static Map<String, Object> request(String tenantId, String channel, String recipient) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId);
        body.put("channel", channel);
        body.put("recipient", recipient);
        body.put("templateKey", "OTP");
        body.put("payload", Map.of("code", "482913", "expiresInSeconds", 300));
        return body;
    }

    @Test
    void sendsThroughTheTenantsOwnAccount_pinnedToItsProvider_andReturnsTheNovuTransaction() {
        MessageSendService.Outcome outcome = service.send(request("acme.city", "SMS", "+254712345678"));

        assertEquals(HttpStatus.OK, outcome.status());
        assertEquals("SENT", outcome.body().get("status"));
        assertEquals("tenant:acme", outcome.body().get("account"));
        assertEquals("jasmin-acme", outcome.body().get("provider"));
        assertTrue(outcome.body().get("transactionId").toString().startsWith("otp-"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> overrides = ArgumentCaptor.forClass(Map.class);
        verify(novu).trigger(eq(ACME), eq("digit-otp-sms"), anyString(), eq("+254712345678"), isNull(),
                payload.capture(), anyString(), overrides.capture());
        assertEquals(Map.of("code", "482913", "expiresInMinutes", 5L, "expiresAt", "2023-11-14T22:18:20Z"),
                payload.getValue());
        assertEquals(Map.of("sms", Map.of("integrationIdentifier", "jasmin-acme")), overrides.getValue());
        verify(novu, never()).trigger(anyString(), anyString(), any(), any(), anyMap(), anyString(), any());
    }

    @Test
    void theLedgerRow_neverCarriesTheCodeOrThePhone() {
        service.send(request("acme.city", "SMS", "+254712345678"));

        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(ledger).upsert(row.capture());
        String written = row.getValue().toString();
        assertFalse(written.contains("482913"), written);
        assertFalse(written.contains("712345678"), written);
        assertEquals("SENT", row.getValue().getStatus());
        assertEquals("OTP", row.getValue().getTemplateKey());
        assertEquals("acme.city", row.getValue().getTenantId());
    }

    @Test
    void anUnprovisionedTenant_is409NotProvisioned_andNothingIsSent() {
        when(tenantAccounts.accountFor("globex")).thenReturn(null);
        when(tenantAccounts.enabled()).thenReturn(true);

        AccountException e = assertThrows(AccountException.class, () -> service.send(request("globex", "SMS", "+254712345678")));

        assertEquals("NB_TENANT_NOT_PROVISIONED", e.code());
        assertEquals(HttpStatus.CONFLICT, e.status());
        verify(novu, never()).trigger(any(NovuAccount.class), anyString(), anyString(), any(), any(), anyMap(), anyString(), any());
    }

    @Test
    void aTenantWithoutAProviderForTheChannel_is422NoProvider_distinctFromNotProvisioned() {
        when(readiness.evaluate(ACME, "acme.city", "SMS")).thenReturn(new ChannelReadiness.Readiness(
                "SMS", false, null, null, null, false, "no active SMS provider is configured"));

        AccountException e = assertThrows(AccountException.class, () -> service.send(request("acme.city", "SMS", "+254712345678")));

        assertEquals("NB_NO_PROVIDER_FOR_CHANNEL", e.code());
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.status());
        verify(novu, never()).trigger(any(NovuAccount.class), anyString(), anyString(), any(), any(), anyMap(), anyString(), any());
    }

    @Test
    void aProviderThatRefusesTheMessage_is502ProviderFailed_withoutEchoingTheCodeOrNumber() {
        notification.put("jobs", List.of(Map.of("type", "sms", "status", "failed", "executionDetails", List.of(
                Map.of("status", "Failed", "detail", "Gateway rejected 482913 for +254712345678")))));

        AccountException e = assertThrows(AccountException.class, () -> service.send(request("acme.city", "SMS", "+254712345678")));

        assertEquals("NB_PROVIDER_FAILED", e.code());
        assertEquals(HttpStatus.BAD_GATEWAY, e.status());
        assertFalse(e.getMessage().contains("482913"), e.getMessage());
        assertFalse(e.getMessage().contains("712345678"), e.getMessage());
        ArgumentCaptor<DispatchLogEntry> row = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(ledger).upsert(row.capture());
        assertEquals("FAILED", row.getValue().getStatus());
        assertEquals("NB_PROVIDER_FAILED", row.getValue().getLastErrorCode());
    }

    @Test
    void stillInFlightAtTheConfirmTimeout_is202Queued() {
        notification.put("jobs", List.of(Map.of("type", "sms", "status", "queued")));

        MessageSendService.Outcome outcome = service.send(request("acme.city", "SMS", "+254712345678"));

        assertEquals(HttpStatus.ACCEPTED, outcome.status());
        assertEquals("QUEUED", outcome.body().get("status"));
    }

    @Test
    void novuDown_is503NovuUnavailable() {
        when(novu.trigger(any(NovuAccount.class), anyString(), anyString(), any(), any(), anyMap(), anyString(), any()))
                .thenThrow(new RuntimeException("connection refused"));

        AccountException e = assertThrows(AccountException.class, () -> service.send(request("acme.city", "SMS", "+254712345678")));

        assertEquals("NB_NOVU_UNAVAILABLE", e.code());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.status());
    }

    @Test
    void email_goesToTheOtpEmailWorkflow() {
        when(readiness.evaluate(ACME, "acme.city", "EMAIL")).thenReturn(new ChannelReadiness.Readiness(
                "EMAIL", true, "smtp-acme", "nodemailer", "smtp", false, null));
        notification.put("jobs", List.of(Map.of("type", "email", "status", "completed")));

        service.send(request("acme.city", "EMAIL", "citizen@example.test"));

        verify(novu).trigger(eq(ACME), eq("digit-otp-email"), anyString(), isNull(), eq("citizen@example.test"),
                anyMap(), anyString(), any());
    }

    @Test
    void invalidRequests_are400_beforeAnyLookup() {
        Map<String, Object> noPlus = request("acme.city", "SMS", "0712345678");
        assertEquals("NB_INVALID_REQUEST", assertThrows(AccountException.class, () -> service.send(noPlus)).code());
        Map<String, Object> whatsapp = request("acme.city", "WHATSAPP", "+254712345678");
        assertEquals("NB_INVALID_REQUEST", assertThrows(AccountException.class, () -> service.send(whatsapp)).code());
        Map<String, Object> otherTemplate = request("acme.city", "SMS", "+254712345678");
        otherTemplate.put("templateKey", "WELCOME");
        assertEquals("NB_UNKNOWN_TEMPLATE", assertThrows(AccountException.class, () -> service.send(otherTemplate)).code());
        Map<String, Object> noExpiry = request("acme.city", "SMS", "+254712345678");
        noExpiry.put("payload", Map.of("code", "482913"));
        assertEquals("NB_INVALID_REQUEST", assertThrows(AccountException.class, () -> service.send(noExpiry)).code());
        Map<String, Object> expired = request("acme.city", "SMS", "+254712345678");
        expired.put("payload", Map.of("code", "482913", "expiresAt", "2020-01-01T00:00:00Z"));
        assertEquals("NB_INVALID_REQUEST", assertThrows(AccountException.class, () -> service.send(expired)).code());
        verify(tenantAccounts, never()).accountFor(anyString());
    }

    @Test
    void expiresAt_isAcceptedAsAnInstant() {
        Map<String, Object> body = request("acme.city", "SMS", "+254712345678");
        body.put("payload", Map.of("code", "482913", "expiresAt", "2023-11-14T22:23:20Z"));
        MessageSendService.Request parsed = service.parse(body);
        assertEquals(10L, parsed.expiresInMinutes());
        assertNull(MessageSendService.failureDetail(Map.of(), "482913"));
    }
}
