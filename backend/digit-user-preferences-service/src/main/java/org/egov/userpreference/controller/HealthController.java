package org.egov.userpreference.controller;

import lombok.RequiredArgsConstructor;
import org.egov.userpreference.repository.PreferenceRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Liveness and readiness probe, served at the container root.
 *
 * <p>Both the compose healthcheck and the Kubernetes probes point at
 * {@code /health} (not at the API's context path and not at
 * {@code /actuator/health}), and the response shape below — a top-level
 * {@code status} plus a {@code components.database.status} — is what the Go
 * service returned. Actuator is on the classpath for metrics and stays at its
 * default {@code /actuator} base path so it does not collide with this.
 */
@RestController
@RequiredArgsConstructor
public class HealthController {

    private static final String UP = "UP";
    private static final String DOWN = "DOWN";

    private final PreferenceRepository preferenceRepository;

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean databaseUp = preferenceRepository.isReachable();
        String status = databaseUp ? UP : DOWN;

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", status);
        body.put("components", Map.of("database", Map.of("status", status)));

        return new ResponseEntity<>(body, databaseUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    }
}
