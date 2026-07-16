package org.egov.pgr.consumer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.service.HrmsProjectionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.util.HashMap;

/**
 * Keeps eg_pgr_hrms_projection in sync with HRMS by consuming the employee
 * create/update topics (VISIBILITY-DESIGN.md §4.3). Org changes reflect on
 * the next inbox load with no complaint re-stamping; the scheduled rebuild in
 * HrmsProjectionService is the backstop for missed events.
 *
 * ENABLING THE FEATURE — two independent switches, both required:
 *  1. Deploy-level: pgr.visibility.enabled=true, normally via the
 *     PGR_VISIBILITY_ENABLED env var in the pgr-services block of
 *     local-setup/docker-compose.egov-digit.yaml (or the per-tenant overlay
 *     docker-compose.<inventory_hostname>.yml on an Ansible box). This is
 *     what gates THIS consumer (@ConditionalOnProperty below), the nightly
 *     rebuild, and the /request/inbox/* endpoints.
 *  2. Per-tenant: MDMS RAINMAKER-PGR.InboxVisibilityConfig with
 *     `enabled: true` (plus `serverSide: true` to move the frontend from
 *     client-composed scoping onto these endpoints) — editable at runtime
 *     via the configurator, no redeploy.
 * With (1) off nothing visibility-related runs at all; with (1) on but (2)
 * off for a tenant, the resolver rejects that tenant's inbox calls and the
 * frontend renders the legacy single inbox.
 */
@Slf4j
@Component
@ConditionalOnProperty(value = "pgr.visibility.enabled", havingValue = "true")
public class HrmsProjectionConsumer {

    @Autowired
    private HrmsProjectionService projectionService;

    @Autowired
    private ObjectMapper mapper;

    @KafkaListener(topics = {"${pgr.hrms.employee.save.topic}", "${pgr.hrms.employee.update.topic}"})
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        try {
            JsonNode employees = mapper.valueToTree(record).path("Employees");
            if (!employees.isArray()) {
                return;
            }
            for (JsonNode employee : employees) {
                projectionService.projectEmployee(employee);
            }
        } catch (Exception e) {
            // Projection sync must never poison the consumer group — the
            // scheduled rebuild reconciles anything skipped here.
            log.error("Failed to project HRMS employee event from topic {}", topic, e);
        }
    }
}
