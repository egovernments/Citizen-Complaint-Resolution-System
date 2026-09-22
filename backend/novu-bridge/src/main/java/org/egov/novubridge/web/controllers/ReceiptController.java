package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.receipts.DeliveryReceipt;
import org.egov.novubridge.service.receipts.ReceiptParser;
import org.egov.novubridge.util.PiiMask;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Delivery receipts (Novu webhook, gateway DR callbacks): move a SENT row to DELIVERED / BOUNCED /
 * FAILED. A machine caller, so outside ProxyAuthFilter and authenticated by a shared secret
 * ({@code X-Receipt-Secret} or {@code ?secret=}); blank secret = endpoint off (403).
 */
@RestController
@RequestMapping("/novu-adapter/v1")
@Slf4j
public class ReceiptController {

    private final ReceiptParser parser;
    private final DispatchLogRepository repository;
    private final NovuBridgeConfiguration config;

    public ReceiptController(ReceiptParser parser, DispatchLogRepository repository, NovuBridgeConfiguration config) {
        this.parser = parser;
        this.repository = repository;
        this.config = config;
    }

    @RequestMapping(value = "/receipts/{provider}", method = {RequestMethod.POST, RequestMethod.GET})
    public ResponseEntity<Map<String, Object>> receive(@PathVariable("provider") String provider,
                                                       @RequestHeader(value = "X-Receipt-Secret", required = false) String headerSecret,
                                                       @RequestParam(value = "secret", required = false) String querySecret,
                                                       @RequestParam Map<String, String> params,
                                                       @RequestBody(required = false) Map<String, Object> body) {
        String expected = config.getReceiptsSecret();
        if (!StringUtils.hasText(expected)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "receipts are disabled (novu.bridge.receipts.secret is blank)"));
        }
        String presented = StringUtils.hasText(headerSecret) ? headerSecret : querySecret;
        // Constant-time: the secret is the only authentication on this path.
        if (presented == null || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                presented.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "bad receipt secret"));
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        if (params != null) params.forEach((k, v) -> { if (!"secret".equals(k)) payload.put(k, v); });
        if (body != null) payload.putAll(body);

        DeliveryReceipt receipt = parser.parse(payload);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("provider", provider);
        out.put("providerStatus", receipt.getProviderStatus());
        out.put("status", receipt.getStatus());
        if (!receipt.isAddressable()) {
            out.put("matched", 0);
            out.put("note", "no transactionId / provider reference in the report");
            return ResponseEntity.ok(out);
        }
        if (!receipt.isTerminal()) {
            out.put("matched", 0);
            out.put("note", "non-terminal report ignored");
            return ResponseEntity.ok(out);
        }
        String errorCode = "DELIVERED".equals(receipt.getStatus()) ? null : "NB_PROVIDER_" + receipt.getStatus();
        int matched = repository.transition(receipt.getTransactionId(), receipt.getProviderRef(), receipt.getStatus(),
                errorCode,
                receipt.getErrorMessage() != null ? receipt.getErrorMessage() : receipt.getProviderStatus(),
                receipt.getRaw());
        log.info("Receipt from {}: status={} providerStatus={} txn={} ref={} matched={}", provider, receipt.getStatus(),
                receipt.getProviderStatus(), PiiMask.maskEmbedded(receipt.getTransactionId()), receipt.getProviderRef(), matched);
        out.put("matched", matched);
        return ResponseEntity.ok(out);
    }
}
