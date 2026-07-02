package org.egov.novubridge.web.controllers;

import org.egov.novubridge.repository.DispatchLogRepository;
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

/**
 * Read-only proxy over the {@code nb_dispatch_log} delivery-log table for the
 * configurator's Notification Logs screen. Sits alongside {@code DispatchController}
 * under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>Observability boundary:</b> {@code nb_dispatch_log} records ONLY the sends
 * that went through novu-bridge's Novu-backed SMS/Email path. Direct Baileys /
 * Telegram WhatsApp deliveries bypass Novu and are NOT written here, so this log
 * is a view of Novu-delivered notifications, not a complete audit of every
 * message a citizen received.
 *
 * <p>Strictly read-only: no create/update/delete, parameterized SQL only (see
 * {@link DispatchLogRepository}), and the response carries no provider secrets
 * (the provider response echoed on each row is the delivery receipt, not the
 * provider's API credentials).
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

    /**
     * List delivery-log rows for a tenant, newest first. {@code tenantId} is
     * required. Optional filters: {@code referenceNumber} (complaint number —
     * exact, or prefix when {@code referenceNumberPrefix=true}), {@code transactionId},
     * {@code channel}, {@code status}. Paged via {@code limit}/{@code offset}.
     *
     * @return {@code {data:[DispatchLogEntry...], total}} where total is the
     *         unpaged count for the same filters.
     */
    @GetMapping("/logs")
    public ResponseEntity<DispatchLogListResponse> logs(
            @RequestParam(name = "tenantId", required = false) String tenantId,
            @RequestParam(name = "referenceNumber", required = false) String referenceNumber,
            @RequestParam(name = "referenceNumberPrefix", required = false, defaultValue = "false") boolean referenceNumberPrefix,
            @RequestParam(name = "transactionId", required = false) String transactionId,
            @RequestParam(name = "channel", required = false) String channel,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "limit", required = false) Integer limit,
            @RequestParam(name = "offset", required = false) Integer offset) {

        if (!StringUtils.hasText(tenantId)) {
            return ResponseEntity.badRequest().build();
        }

        int effectiveLimit = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
        int effectiveOffset = offset == null ? 0 : Math.max(offset, 0);

        List<DispatchLogEntry> data = dispatchLogRepository.list(
                tenantId, referenceNumber, referenceNumberPrefix, transactionId, channel, status,
                effectiveLimit, effectiveOffset);
        long total = dispatchLogRepository.count(
                tenantId, referenceNumber, referenceNumberPrefix, transactionId, channel, status);

        DispatchLogListResponse response = DispatchLogListResponse.builder()
                .data(data)
                .total(total)
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
