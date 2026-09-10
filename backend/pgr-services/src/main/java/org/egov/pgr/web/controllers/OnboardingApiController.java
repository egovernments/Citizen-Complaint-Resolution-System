package org.egov.pgr.web.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reserves the PGR onboarding API contract tracked by CCRS #1999.
 *
 * <p>These handlers intentionally have no side effects. They return HTTP 501 until the
 * onboarding orchestration and persistence implementation is added.</p>
 */
@RestController
@RequestMapping("/v2/onboarding")
public class OnboardingApiController {

    private static final String ERROR_CODE = "PGR_ONBOARDING_NOT_IMPLEMENTED";
    private static final String ERROR_MESSAGE =
            "The PGR onboarding route contract is reserved; implementation is tracked in CCRS #1999.";

    @PostMapping("/signups/_create")
    public ResponseEntity<Map<String, String>> createSignup(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("signups.create");
    }

    @PostMapping("/signups/_update")
    public ResponseEntity<Map<String, String>> updateSignup(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("signups.update");
    }

    @PostMapping("/signups/_search")
    public ResponseEntity<Map<String, String>> searchSignups(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("signups.search");
    }

    @PostMapping("/identifiers/_check")
    public ResponseEntity<Map<String, String>> checkIdentifier(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("identifiers.check");
    }

    @PostMapping("/signups/_submit")
    public ResponseEntity<Map<String, String>> submitSignup(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("signups.submit");
    }

    @PostMapping("/operations/_search")
    public ResponseEntity<Map<String, String>> searchOperations(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("operations.search");
    }

    @PostMapping("/operations/_retry")
    public ResponseEntity<Map<String, String>> retryOperation(
            @RequestBody(required = false) Map<String, Object> request) {
        return notImplemented("operations.retry");
    }

    private ResponseEntity<Map<String, String>> notImplemented(String operation) {
        // TODO(#1999): Delegate to the onboarding application service once its workflow is implemented.
        Map<String, String> response = new LinkedHashMap<>();
        response.put("code", ERROR_CODE);
        response.put("message", ERROR_MESSAGE);
        response.put("operation", operation);
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(response);
    }
}
