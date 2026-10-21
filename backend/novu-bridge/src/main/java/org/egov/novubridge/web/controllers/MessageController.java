package org.egov.novubridge.web.controllers;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.MessageSendService;
import org.egov.novubridge.web.models.DerivedContext;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The internal send API. InternalAuthFilter admits {@code X-Novu-Bridge-Token} =
 * {@code novu.bridge.internal.send.token} (the Identity BFF) on every path here, and Kong
 * terminates the prefix. Contract: {@code contract/openapi.yaml}.
 * <ul>
 *   <li>{@code POST /messages/_send} (#2203): an OTP, sent now through the tenant's own Novu
 *       account; outcomes in {@link MessageSendService}.</li>
 *   <li>{@code POST /messages/_dispatch}: one pre-rendered envelope, the v1 contract of the Kafka
 *       topics, sent now for a caller with no Kafka client.</li>
 * </ul>
 */
@RestController
@RequestMapping("/novu-adapter/v1/messages")
public class MessageController {

    private final MessageSendService sender;
    private final DispatchPipelineService pipeline;
    private final DispatchLogRepository dispatchLog;

    public MessageController(MessageSendService sender, DispatchPipelineService pipeline,
                             DispatchLogRepository dispatchLog) {
        this.sender = sender;
        this.pipeline = pipeline;
        this.dispatchLog = dispatchLog;
    }

    @PostMapping("/_send")
    public ResponseEntity<Map<String, Object>> send(@RequestBody(required = false) Map<String, Object> body) {
        MessageSendService.Outcome outcome = sender.send(body);
        return ResponseEntity.status(outcome.status()).body(Map.of("data", outcome.body()));
    }

    /**
     * The same pipeline as the topics (eventType allowlist, replay guard, channel policy, provider
     * checks, tenant account, one ledger row), consent aside: {@link DispatchPipelineService#processInternal}.
     * {@code status} is what the ledger row says: {@code SENT} (now, or earlier for the same
     * transactionId, channel and subscriber), {@code SKIPPED} or {@code FAILED}.
     */
    @PostMapping("/_dispatch")
    public ResponseEntity<Map<String, Object>> dispatch(@RequestBody(required = false) NotificationEvent event) {
        if (event == null) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_EVENT", "Event payload is required");
        }
        DispatchResult result;
        try {
            result = pipeline.processInternal(event);
        } catch (CustomException e) {
            // The pipeline wrote the REJECTED or FAILED row before it threw.
            String code = e.getCode() == null ? "" : e.getCode();
            boolean rejected = code.startsWith("NB_INVALID") || code.startsWith("NB_UNSUPPORTED");
            throw new AccountException(rejected ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY, code, e.getMessage());
        }
        DerivedContext context = result.getDerivedContext();
        String status = dispatchLog.findStatus(context.getTransactionId(), context.getChannel(),
                StringUtils.hasText(context.getSubscriberId()) ? context.getSubscriberId() : context.getRecipientUserId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", status != null ? status : Boolean.TRUE.equals(result.getNovuTriggered()) ? "SENT" : "NOT_SENT");
        out.put("transactionId", context.getTransactionId());
        out.put("diagnostics", result.getDiagnostics());
        return ResponseEntity.ok(Map.of("data", out));
    }

    @ExceptionHandler(AccountException.class)
    ResponseEntity<Map<String, Object>> refused(AccountException e) {
        return e.toResponse();
    }

    /** The account lookup failing closed (NB_TENANT_ACCOUNT_UNAVAILABLE) is a 503, not a 400. */
    @ExceptionHandler(CustomException.class)
    ResponseEntity<Map<String, Object>> failed(CustomException e) {
        return new AccountException(HttpStatus.SERVICE_UNAVAILABLE, e.getCode(), e.getMessage()).toResponse();
    }
}
