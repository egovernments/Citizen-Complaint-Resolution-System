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
