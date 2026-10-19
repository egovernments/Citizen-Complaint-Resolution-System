package org.egov.novubridge.service.receipts;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ReceiptParserTest {

    private final ReceiptParser parser = new ReceiptParser();

    @Test
    void novuWebhook_deliveredEvent_isTerminalAndAddressableByTransactionId() {
        Map<String, Object> hook = Map.of(
                "type", "message.delivered",
                "payload", Map.of("message", Map.of("transactionId", "PGR-1:ASSIGN:PENDINGATLME:ke:u1:SMS", "channel", "sms")));
        DeliveryReceipt r = parser.parse(hook);
        assertEquals("DELIVERED", r.getStatus());
        assertEquals("PGR-1:ASSIGN:PENDINGATLME:ke:u1:SMS", r.getTransactionId());
        assertTrue(r.isTerminal() && r.isAddressable());
    }

    @Test
    void novuWebhook_sentEvent_isNotTerminal() {
        DeliveryReceipt r = parser.parse(Map.of("status", "sent", "transactionId", "t"));
        assertNull(r.getStatus());
        assertFalse(r.isTerminal());
    }

    @Test
    void smscountryDeliveryReport_mapsGatewayWords() {
        assertEquals("DELIVERED", parser.parse(Map.of("jobno", "4689", "status", "DELIVRD")).getStatus());
        assertEquals("FAILED", parser.parse(Map.of("jobno", "4689", "status", "UNDELIV")).getStatus());
        assertEquals("FAILED", parser.parse(Map.of("JobNo", "4689", "Status", "EXPIRED")).getStatus());
        assertEquals("4689", parser.parse(Map.of("JobNo", "4689", "Status", "EXPIRED")).getProviderRef());
    }

    @Test
    void bouncedAndFailedWordsAreDistinguished_andUnknownIsIgnored() {
        assertEquals("BOUNCED", ReceiptParser.mapStatus("email.bounced"));
        assertEquals("FAILED", ReceiptParser.mapStatus("rejected"));
        assertEquals("FAILED", ReceiptParser.mapStatus("undelivered"));
        assertNull(ReceiptParser.mapStatus("queued"));
        assertNull(ReceiptParser.mapStatus(null));
    }

    @Test
    void reportWithoutAnyReference_isNotAddressable() {
        DeliveryReceipt r = parser.parse(Map.of("status", "delivered", "messages", List.of(Map.of("foo", "bar"))));
        assertFalse(r.isAddressable());
    }
}
