package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Lease contract for the external provisioning worker. PGR records progress and
 * outcome only; it performs no tenant, Keycloak or DIGIT account provisioning.
 */
@Service
public class OnboardingWorkerService {

    static final long MAX_LEASE_SECONDS = 900;

    private final OnboardingRepository repository;

    public OnboardingWorkerService(OnboardingRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public Optional<Map<String, Object>> claim(String workerId, long leaseSeconds) {
        if (workerId == null || workerId.isBlank() || workerId.length() > 128) {
            throw new CustomException("ONBOARDING_WORKER_INVALID", "workerId is required");
        }
        long seconds = Math.max(30, Math.min(MAX_LEASE_SECONDS, leaseSeconds));
        long now = System.currentTimeMillis();
        Optional<OnboardingLease> lease = repository.claimOperation(
                workerId.trim(), UUID.randomUUID(), now + seconds * 1000, now);
        if (lease.isEmpty()) return Optional.empty();
        OnboardingSignup signup = repository.findSignup(lease.get().getOperation().getSignupId())
                .orElseThrow(() -> new CustomException("ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("Operation", lease.get().getOperation());
        result.put("leaseToken", lease.get().getLeaseToken().toString());
        result.put("leaseExpiresAt", lease.get().getLeaseExpiresAt());
        result.put("Signup", signup);
        return Optional.of(result);
    }

    @Transactional
    public void complete(UUID operationId, UUID leaseToken, List<String> completedSteps) {
        long now = System.currentTimeMillis();
        OnboardingOperation operation = requireLease(operationId, leaseToken, "SUCCEEDED",
                completedSteps, null, null, null, now);
        repository.settleSignup(operation.getSignupId(), "ACTIVE", "CONSUMED", now);
    }

    @Transactional
    public void fail(UUID operationId, UUID leaseToken, boolean retryable, String errorCode,
                     String errorMessage, String currentStep, List<String> completedSteps) {
        long now = System.currentTimeMillis();
        String code = errorCode == null || errorCode.isBlank() ? "ONBOARDING_PROVISIONING_FAILED" : errorCode.trim();
        String message = errorMessage == null ? null
                : errorMessage.length() > 500 ? errorMessage.substring(0, 500) : errorMessage;
        OnboardingOperation operation = requireLease(operationId, leaseToken,
                retryable ? "RETRYABLE_FAILED" : "TERMINAL_FAILED", completedSteps,
                currentStep, code.length() > 128 ? code.substring(0, 128) : code, message, now);
        // Partial root/KC objects are deliberately quarantined. Releasing their
        // identifiers would let another signup collide with materialized state.
        if (!retryable) repository.settleSignup(operation.getSignupId(), "FAILED", "RESERVED", now);
    }

    private OnboardingOperation requireLease(UUID operationId, UUID leaseToken, String status, List<String> steps,
                                             String currentStep, String errorCode, String errorMessage, long now) {
        OnboardingOperation operation = repository.findOperation(operationId)
                .orElseThrow(() -> new CustomException("ONBOARDING_OPERATION_NOT_FOUND", "Operation was not found"));
        List<String> completed = steps == null ? new ArrayList<>() : steps;
        if (!repository.finishOperation(operationId, leaseToken, status, completed, currentStep,
                errorCode, errorMessage, now)) {
            throw new CustomException("ONBOARDING_LEASE_LOST", "The operation lease is no longer held");
        }
        return operation;
    }
}
