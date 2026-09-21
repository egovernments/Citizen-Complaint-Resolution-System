package org.egov.pgr.web.controllers;

import jakarta.servlet.http.HttpServletRequest;
import org.egov.pgr.onboarding.IdentitySessionClient;
import org.egov.pgr.onboarding.OnboardingOperation;
import org.egov.pgr.onboarding.OnboardingPrincipal;
import org.egov.pgr.onboarding.OnboardingService;
import org.egov.pgr.onboarding.OnboardingSignup;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/v2/onboarding")
public class OnboardingApiController {

    private final IdentitySessionClient identitySessionClient;
    private final OnboardingService service;

    public OnboardingApiController(IdentitySessionClient identitySessionClient, OnboardingService service) {
        this.identitySessionClient = identitySessionClient;
        this.service = service;
    }

    @PostMapping("/signups/_create")
    public ResponseEntity<Map<String, Object>> createSignup(
            HttpServletRequest httpRequest,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) Map<String, Object> request) {
        OnboardingSignup signup = service.create(principal(httpRequest), nested(request, "Signup"), idempotencyKey);
        return ResponseEntity.status(HttpStatus.CREATED).body(single("Signup", signup));
    }

    @PostMapping("/signups/_update")
    public ResponseEntity<Map<String, Object>> updateSignup(HttpServletRequest httpRequest,
            @RequestBody Map<String, Object> request) {
        return ResponseEntity.ok(single("Signup",
                service.update(principal(httpRequest), nested(request, "Signup"))));
    }

    @PostMapping("/signups/_search")
    public ResponseEntity<Map<String, Object>> searchSignups(HttpServletRequest httpRequest,
            @RequestBody(required = false) Map<String, Object> request) {
        List<OnboardingSignup> signups = service.search(principal(httpRequest), nested(request, "Signup"));
        return ResponseEntity.ok(single("Signups", signups));
    }

    @PostMapping("/identifiers/_check")
    public ResponseEntity<Map<String, Object>> checkIdentifier(HttpServletRequest httpRequest,
            @RequestBody Map<String, Object> request) {
        Map<String, Object> identifier = new LinkedHashMap<>(service.checkIdentifier(
                principal(httpRequest), nested(request, "Identifier")));
        String type = identifier.get("type").toString();
        Object derivedTenantId = identifier.get("derivedTenantId");
        if (Boolean.TRUE.equals(identifier.get("available"))
                && !identitySessionClient.identifierAvailable(type, identifier.get("value").toString())) {
            identifier.put("available", false);
            identifier.put("conflictingType", type);
        }
        // A free slug whose derived tenant id is taken is not a free slug.
        if (Boolean.TRUE.equals(identifier.get("available")) && derivedTenantId != null
                && !identitySessionClient.identifierAvailable("TENANT_ID", derivedTenantId.toString())) {
            identifier.put("available", false);
            identifier.put("conflictingType", "TENANT_ID");
        }
        return ResponseEntity.ok(single("Identifier", identifier));
    }

    @PostMapping("/signups/_submit")
    public ResponseEntity<Map<String, Object>> submitSignup(
            HttpServletRequest httpRequest,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody Map<String, Object> request) {
        OnboardingPrincipal principal = principal(httpRequest);
        Map<String, Object> signupRequest = nested(request, "Signup");
        List<OnboardingSignup> owned = service.search(principal, signupRequest);
        if (owned.isEmpty()) {
            throw new CustomException("ONBOARDING_SIGNUP_NOT_FOUND", "Signup was not found");
        }
        OnboardingSignup signup = owned.get(0);
        // A replayed submit must answer with its operation. By now the worker may have
        // materialized the signup's own tenant or organization, and the loop below
        // would report the signup's identifiers as taken by itself.
        Optional<OnboardingOperation> replay = service.replayOperation(principal, signupRequest);
        if (replay.isPresent()) {
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(single("Operation", replay.get()));
        }
        Map<String, String> identifiers = new LinkedHashMap<>();
        identifiers.put("ORGANIZATION_NAME", OnboardingService.normalizeOrganizationName(
                requiredIdentifier(signup.getAccountName(), "Signup.accountName")));
        identifiers.put("ACCOUNT_CODE", requiredIdentifier(signup.getAccountCode(), "Signup.accountCode"));
        identifiers.put("TENANT_ID", requiredIdentifier(signup.getRequestedTenantId(), "Signup.requestedTenantId"));
        identifiers.put("ORGANIZATION_ALIAS", requiredIdentifier(
                signup.getOrganizationAlias(), "Signup.organizationAlias"));
        identifiers.put("URL_SLUG", requiredIdentifier(signup.getUrlSlug(), "Signup.urlSlug"));
        for (Map.Entry<String, String> identifier : identifiers.entrySet()) {
            if (!identitySessionClient.identifierAvailable(identifier.getKey(), identifier.getValue())) {
                throw new CustomException("ONBOARDING_IDENTIFIER_TAKEN",
                        identifier.getKey() + " is already in use");
            }
        }
        OnboardingOperation operation = service.submit(principal, signupRequest, idempotencyKey);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(single("Operation", operation));
    }

    @PostMapping("/operations/_search")
    public ResponseEntity<Map<String, Object>> searchOperations(HttpServletRequest httpRequest,
            @RequestBody Map<String, Object> request) {
        return ResponseEntity.ok(single("Operations",
                service.searchOperations(principal(httpRequest), nested(request, "Operation"))));
    }

    @PostMapping("/operations/_retry")
    public ResponseEntity<Map<String, Object>> retryOperation(HttpServletRequest httpRequest,
            @RequestBody Map<String, Object> request) {
        return ResponseEntity.accepted().body(single("Operation",
                service.retry(principal(httpRequest), nested(request, "Operation"))));
    }

    // Identity failures keep their HTTP status (401/503). Without this, the tracer's
    // catch-all advice reports every unauthenticated onboarding call as a 400.
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> identityFailure(ResponseStatusException exception) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", exception.getStatusCode().value() == 401
                ? "ONBOARDING_IDENTITY_REQUIRED" : "ONBOARDING_IDENTITY_UNAVAILABLE");
        error.put("message", exception.getReason());
        return ResponseEntity.status(exception.getStatusCode())
                .body(single("Errors", Collections.singletonList(error)));
    }

    private OnboardingPrincipal principal(HttpServletRequest request) {
        return identitySessionClient.introspect(request.getHeader("Cookie"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> nested(Map<String, Object> request, String key) {
        if (request == null) return Collections.emptyMap();
        Object value = request.get(key);
        return value instanceof Map ? (Map<String, Object>) value : Collections.emptyMap();
    }

    private Map<String, Object> single(String key, Object value) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put(key, value);
        return response;
    }

    private String requiredIdentifier(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new CustomException("ONBOARDING_VALIDATION_ERROR", field + " is required");
        }
        return value.trim();
    }
}
