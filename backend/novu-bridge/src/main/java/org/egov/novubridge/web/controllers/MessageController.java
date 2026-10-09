package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.MessageSendService;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * {@code POST /novu-adapter/v1/messages/_send} (#2203): an OTP, sent now through the tenant's own
 * Novu account. Internal only: InternalAuthFilter admits {@code X-Novu-Bridge-Token} =
 * {@code novu.bridge.internal.send.token} (the Identity BFF), and Kong terminates the prefix.
 * Contract: {@code contract/openapi.yaml}, outcomes: {@link MessageSendService}.
 */
@RestController
@RequestMapping("/novu-adapter/v1/messages")
public class MessageController {

    private final MessageSendService sender;

    public MessageController(MessageSendService sender) {
        this.sender = sender;
    }

    @PostMapping("/_send")
    public ResponseEntity<Map<String, Object>> send(@RequestBody(required = false) Map<String, Object> body) {
        MessageSendService.Outcome outcome = sender.send(body);
        return ResponseEntity.status(outcome.status()).body(Map.of("data", outcome.body()));
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
