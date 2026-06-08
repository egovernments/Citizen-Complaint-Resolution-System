package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Dynamic analytics query API over the V2 grains.
 *
 *   POST /v2/analytics/_query   — single or batch named queries
 *   POST /v2/analytics/_schema  — catalog for FE KPI editor
 */
@RestController
@RequestMapping("/v2/analytics")
@RequiredArgsConstructor
@Slf4j
public class AnalyticsController {

    private final AnalyticsService service;
    private final ObjectMapper mapper;
    private final PGRConfiguration config;

    @PostMapping("/_query")
    public ResponseEntity<Map<String, Object>> query(
            @RequestBody JsonNode body,
            @AuthenticationPrincipal Jwt jwt) {
        try {
            String userId   = jwt != null ? jwt.getSubject() : null;
            List<String> roles = getRoles(jwt);
            String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
            int stateLen = config.getStateLevelTenantIdLength() != null
                    ? config.getStateLevelTenantIdLength() : 1;

            Map<String, Object> result = service.query(body, userId, roles, tenantId, stateLen);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics query failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    @PostMapping("/_schema")
    public ResponseEntity<Map<String, Object>> schema() {
        return ResponseEntity.ok(service.schema());
    }

    @SuppressWarnings("unchecked")
    private List<String> getRoles(Jwt jwt) {
        if (jwt == null) return Collections.emptyList();
        Map<String, Object> realmAccess = jwt.getClaim("realm_access");
        if (realmAccess == null) return Collections.emptyList();
        return (List<String>) realmAccess.getOrDefault("roles", Collections.emptyList());
    }

    private Map<String, Object> error(Exception e) {
        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
        String code = msg.contains(":") ? msg.substring(0, msg.indexOf(':')) : "query_failed";
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("message", msg);
        return m;
    }
}
