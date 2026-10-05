package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.receipts.ReceiptParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ReceiptControllerTest {

    private DispatchLogRepository repository;
    private NovuBridgeConfiguration config;
    private ReceiptController controller;

    @BeforeEach
    void setUp() {
        repository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setReceiptsSecret("s3cret");
        controller = new ReceiptController(new ReceiptParser(), repository, config);
    }

    @Test
    void disabledWhenNoSecretConfigured() {
        config.setReceiptsSecret("");
        assertEquals(403, controller.receive("novu", "x", null, Map.of(), Map.of("status", "delivered", "transactionId", "t")).getStatusCode().value());
        verifyNoInteractions(repository);
    }

    @Test
    void wrongSecret_isUnauthorized() {
        assertEquals(401, controller.receive("novu", "nope", null, Map.of(), Map.of("status", "delivered", "transactionId", "t")).getStatusCode().value());
        verifyNoInteractions(repository);
    }

    @Test
    void terminalReport_transitionsTheRow_andReportsMatches() {
        when(repository.transition(eq("t-1"), isNull(), eq("DELIVERED"), isNull(), any(), any())).thenReturn(1);
        Map<String, Object> out = controller.receive("novu", "s3cret", null, Map.of(), Map.of("type", "message.delivered", "transactionId", "t-1")).getBody();
        assertEquals(1, out.get("matched"));
        assertEquals("DELIVERED", out.get("status"));
    }

    @Test
    void querySecret_andFormParams_workForGatewayPings() {
        when(repository.transition(isNull(), eq("4689"), eq("FAILED"), eq("NB_PROVIDER_FAILED"), any(), any())).thenReturn(1);
        Map<String, Object> out = controller.receive("smscountry", null, "s3cret", Map.of("jobno", "4689", "status", "UNDELIV", "secret", "s3cret"), null).getBody();
        assertEquals(1, out.get("matched"));
    }

    @Test
    void nonTerminalReport_isAcknowledgedButIgnored() {
        Map<String, Object> out = controller.receive("novu", "s3cret", null, Map.of(), Map.of("status", "sent", "transactionId", "t-1")).getBody();
        assertEquals(0, out.get("matched"));
        verify(repository, never()).transition(any(), any(), any(), any(), any(), any());
    }
}
