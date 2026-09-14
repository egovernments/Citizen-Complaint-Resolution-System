package org.egov.pgr.web.controllers;

import jakarta.servlet.http.HttpServletRequest;
import org.egov.pgr.onboarding.IdentitySessionClient;
import org.egov.pgr.onboarding.OnboardingOperation;
import org.egov.pgr.onboarding.OnboardingPrincipal;
import org.egov.pgr.onboarding.OnboardingService;
import org.egov.pgr.onboarding.OnboardingSignup;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
        return ResponseEntity.ok(single("Identifier",
                service.checkIdentifier(principal(httpRequest), nested(request, "Identifier"))));
    }

    @PostMapping("/signups/_submit")
    public ResponseEntity<Map<String, Object>> submitSignup(
            HttpServletRequest httpRequest,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody Map<String, Object> request) {
        OnboardingOperation operation = service.submit(
                principal(httpRequest), nested(request, "Signup"), idempotencyKey);
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
}
