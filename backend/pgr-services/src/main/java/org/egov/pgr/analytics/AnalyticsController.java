package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Dynamic analytics query API over the V2 grains (complaint_facts / complaint_events /
 * complaint_open_state_daily).
 *
 *   POST /v2/analytics/_query   — run a single query or a batch dict of named queries
 *   POST /v2/analytics/_schema  — capabilities/catalog so the FE can build the KPI editor
 *
 * Body (single):  { "RequestInfo": {...}, "tenantId": "ke", "query": { ...grammar... } }
 * Body (batch):   { "RequestInfo": {...}, "tenantId": "ke", "queries": { "name": {...}, ... } }
 */
@RestController
@RequestMapping("/v2/analytics")
@Slf4j
public class AnalyticsController {

    private final AnalyticsService service;
    private final ObjectMapper mapper;
    private final PGRConfiguration config;

    @Autowired
    public AnalyticsController(AnalyticsService service, ObjectMapper mapper, PGRConfiguration config){
        this.service = service; this.mapper = mapper; this.config = config;
    }

    @PostMapping("/_query")
    public ResponseEntity<Map<String,Object>> query(@RequestBody JsonNode body){
        try {
            RequestInfo requestInfo = body.has("RequestInfo")
                    ? mapper.convertValue(body.get("RequestInfo"), RequestInfo.class) : null;
            String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
            int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
            Map<String,Object> result = service.query(body, requestInfo, tenantId, stateLen);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics query failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    @PostMapping("/_schema")
    public ResponseEntity<Map<String,Object>> schema(){
        return ResponseEntity.ok(service.schema());
    }

    private Map<String,Object> error(Exception e){
        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
        String code = msg.contains(":") ? msg.substring(0, msg.indexOf(':')) : "query_failed";
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("message", msg);
        return m;
    }
}
