package org.egov.novubridge.web.controllers;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchLogListResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Read-only Notification Logs screen over {@code nb_dispatch_log}: parameterized SQL only, and
 * recipient PII masked server-side.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class DispatchLogController {

    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 500;

    private final DispatchLogRepository dispatchLogRepository;

    public DispatchLogController(DispatchLogRepository dispatchLogRepository) {
        this.dispatchLogRepository = dispatchLogRepository;
    }

    /** Newest first; {@code total} is the unpaged count for the same filters. */
    @GetMapping("/logs")
    public ResponseEntity<DispatchLogListResponse> logs(
            @RequestParam(name = "tenantId", required = false) String tenantId,
            @RequestParam(name = "referenceNumber", required = false) String referenceNumber,
            @RequestParam(name = "referenceNumberPrefix", required = false, defaultValue = "false") boolean referenceNumberPrefix,
            @RequestParam(name = "transactionId", required = false) String transactionId,
            @RequestParam(name = "channel", required = false) String channel,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "sourcePath", required = false) String sourcePath,
            @RequestParam(name = "includeTest", required = false, defaultValue = "false") boolean includeTest,
            @RequestParam(name = "limit", required = false) Integer limit,
            @RequestParam(name = "offset", required = false) Integer offset) {

        if (!StringUtils.hasText(tenantId)) {
            return ResponseEntity.badRequest().build();
        }

        int effectiveLimit = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
        int effectiveOffset = offset == null ? 0 : Math.max(offset, 0);

        List<DispatchLogEntry> data = dispatchLogRepository.list(
                tenantId, referenceNumber, referenceNumberPrefix, transactionId, channel, status, sourcePath,
                includeTest, effectiveLimit, effectiveOffset);
        long total = dispatchLogRepository.count(
                tenantId, referenceNumber, referenceNumberPrefix, transactionId, channel, status, sourcePath,
                includeTest);

        // recipient_value and transaction_id can embed a raw phone (tenantId:mobile), and the stored
        // provider response echoes the raw transactionId, so all three are masked on the way out.
        List<DispatchLogEntry> masked = data.stream()
                .map(e -> e.toBuilder()
                        .recipientValue(PiiMask.mask(e.getRecipientValue()))
                        .transactionId(PiiMask.maskEmbedded(e.getTransactionId()))
                        .providerResponse(PiiMask.maskDeep(e.getProviderResponse()))
                        .build())
                .collect(Collectors.toList());

        DispatchLogListResponse response = DispatchLogListResponse.builder()
                .data(masked)
                .total(total)
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
