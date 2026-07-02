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
 * Read-only proxy over the {@code nb_dispatch_log} delivery-log table for the
 * configurator's Notification Logs screen. Sits alongside {@code DispatchController}
 * under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>Observability:</b> every event consumed from the domain topic lands here with an
 * explicit terminal status — SENT, SKIPPED (preference denied / no provider / unsupported
 * channel) or FAILED. Channels without an enabled provider (e.g. WHATSAPP before a legitimate
 * provider is onboarded) appear as SKIPPED/NB_NO_PROVIDER rather than being invisible.
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

        // Mask recipient PII server-side so the full value never crosses the wire.
        // recipient_value is the subscriberId (tenantId:userUuid, or tenantId:mobile
        // when the uuid was missing) and transaction_id embeds the same subscriberId.
        List<DispatchLogEntry> masked = data.stream()
                .map(e -> e.toBuilder()
                        .recipientValue(PiiMask.mask(e.getRecipientValue()))
                        .transactionId(PiiMask.maskEmbedded(e.getTransactionId()))
                        .build())
                .collect(Collectors.toList());

        DispatchLogListResponse response = DispatchLogListResponse.builder()
                .data(masked)
                .total(total)
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
