package org.egov.pgr.web.controllers;

import org.egov.pgr.onboarding.OnboardingWorkerService;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Workload-only lease API for the onboarding provisioning worker. Not routed
 * as an auth-optional Kong path; callers reach it on the internal network with
 * PGR_ONBOARDING_WORKER_TOKEN, a credential distinct from session introspection.
 */
@RestController
@RequestMapping("/v2/onboarding/internal/operations")
public class OnboardingWorkerController {

    private final OnboardingWorkerService service;
    private final String workerToken;

    public OnboardingWorkerController(OnboardingWorkerService service,
                                      @Value("${pgr.onboarding.worker.token:}") String workerToken) {
        this.service = service;
        this.workerToken = workerToken == null ? "" : workerToken;
    }

    @PostMapping("/_claim")
    public ResponseEntity<Map<String, Object>> claim(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) Map<String, Object> request) {
        requireWorker(authorization);
        Map<String, Object> body = request == null ? Collections.emptyMap() : request;
        long leaseSeconds = body.get("leaseSeconds") instanceof Number
                ? ((Number) body.get("leaseSeconds")).longValue() : 120;
        return service.claim(string(body.get("workerId")), leaseSeconds)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/_complete")
    public ResponseEntity<Map<String, Object>> complete(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody Map<String, Object> request) {
        requireWorker(authorization);
        service.complete(uuid(request.get("id")), uuid(request.get("leaseToken")), steps(request));
        return ResponseEntity.ok(Collections.singletonMap("status", "SUCCEEDED"));
    }

    @PostMapping("/_fail")
    public ResponseEntity<Map<String, Object>> fail(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody Map<String, Object> request) {
        requireWorker(authorization);
        boolean retryable = !Boolean.FALSE.equals(request.get("retryable"));
        service.fail(uuid(request.get("id")), uuid(request.get("leaseToken")), retryable,
                string(request.get("errorCode")), string(request.get("errorMessage")),
                string(request.get("currentStep")), steps(request));
        return ResponseEntity.ok(Collections.singletonMap("status", retryable ? "RETRYABLE_FAILED" : "TERMINAL_FAILED"));
    }

    @ExceptionHandler(WorkerAuthException.class)
    public ResponseEntity<Map<String, Object>> unauthorized(WorkerAuthException exception) {
        return error(exception.status, "ONBOARDING_WORKER_UNAUTHORIZED", exception.getMessage());
    }

    @ExceptionHandler(CustomException.class)
    public ResponseEntity<Map<String, Object>> rejected(CustomException exception) {
        HttpStatus status = "ONBOARDING_LEASE_LOST".equals(exception.getCode()) ? HttpStatus.CONFLICT
                : exception.getCode() != null && exception.getCode().endsWith("NOT_FOUND") ? HttpStatus.NOT_FOUND
                : HttpStatus.BAD_REQUEST;
        return error(status, exception.getCode(), exception.getMessage());
    }

    private void requireWorker(String authorization) {
        if (workerToken.isBlank()) {
            throw new WorkerAuthException(HttpStatus.SERVICE_UNAVAILABLE, "Onboarding worker access is not configured");
        }
        String supplied = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7) : "";
        if (!MessageDigest.isEqual(supplied.getBytes(StandardCharsets.UTF_8), workerToken.getBytes(StandardCharsets.UTF_8))) {
            throw new WorkerAuthException(HttpStatus.UNAUTHORIZED, "Invalid onboarding worker credential");
        }
    }

    @SuppressWarnings("unchecked")
    private List<String> steps(Map<String, Object> request) {
        Object value = request.get("completedSteps");
        if (value == null) return Collections.emptyList();
        if (!(value instanceof List) || !((List<Object>) value).stream().allMatch(String.class::isInstance)) {
            throw new CustomException("ONBOARDING_WORKER_INVALID", "completedSteps must be a string array");
        }
        return (List<String>) value;
    }

    private UUID uuid(Object value) {
        try {
            return UUID.fromString(String.valueOf(value));
        } catch (IllegalArgumentException exception) {
            throw new CustomException("ONBOARDING_WORKER_INVALID", "id and leaseToken must be UUIDs");
        }
    }

    private String string(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", message);
        return ResponseEntity.status(status).body(Collections.singletonMap("Errors", Collections.singletonList(error)));
    }

    static class WorkerAuthException extends RuntimeException {
        private final HttpStatus status;

        WorkerAuthException(HttpStatus status, String message) {
            super(message);
            this.status = status;
        }
    }
}
