package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.HrmsProjectionRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Collections;

/**
 * Owns eg_pgr_hrms_projection (VISIBILITY-DESIGN.md §4.3): parses HRMS
 * employee payloads into projection rows (used by HrmsProjectionConsumer for
 * the streaming path) and runs the full-rebuild backstop — nightly, plus once
 * at boot when the projection is empty (first deploy backfill).
 */
@Slf4j
@Service
@ConditionalOnProperty(value = "pgr.visibility.enabled", havingValue = "true")
public class HrmsProjectionService {

    private final HrmsProjectionRepository projectionRepository;
    private final ServiceRequestRepository serviceRequestRepository;
    private final PGRConfiguration config;
    private final ObjectMapper mapper;

    @Value("${egov.state.level.tenant.id:ke}")
    private String stateLevelTenantId;

    @Value("${pgr.visibility.rebuild.batch.size:100}")
    private int rebuildBatchSize;

    public HrmsProjectionService(HrmsProjectionRepository projectionRepository,
                                 ServiceRequestRepository serviceRequestRepository,
                                 PGRConfiguration config, ObjectMapper mapper) {
        this.projectionRepository = projectionRepository;
        this.serviceRequestRepository = serviceRequestRepository;
        this.config = config;
        this.mapper = mapper;
    }

    /** Upsert one HRMS employee node (same shape in topics and _search). */
    public void projectEmployee(JsonNode employee) {
        String uuid = firstNonBlank(employee.path("uuid").asText(null),
                employee.path("user").path("uuid").asText(null));
        String tenantId = employee.path("tenantId").asText(null);
        if (uuid == null || tenantId == null) {
            log.warn("HRMS employee payload without uuid/tenantId — skipped");
            return;
        }

        // employee-level isActive; some flows omit it, then the user's active
        // flag is the signal. Default true.
        boolean active = employee.path("isActive").asBoolean(
                employee.path("user").path("active").asBoolean(true));

        String reportingTo = null;
        String department = null;
        for (JsonNode assignment : employee.path("assignments")) {
            // same selection rule as HRMSUtil's HRMS_REPORTING_TO_JSONPATH:
            // the current assignment carries the org edge
            if (assignment.path("isCurrentAssignment").asBoolean(false)) {
                reportingTo = assignment.path("reportingTo").asText(null);
                department = assignment.path("department").asText(null);
                break;
            }
        }

        projectionRepository.upsert(uuid, tenantId, reportingTo, department, active);
    }

    /** Nightly reconciliation backstop for missed topic events. */
    @Scheduled(cron = "${pgr.visibility.rebuild.cron:0 45 2 * * *}")
    public void scheduledRebuild() {
        rebuildProjection();
    }

    /** First-deploy backfill: existing employees never re-fire the HRMS topics. */
    @EventListener(ApplicationReadyEvent.class)
    public void backfillOnBootIfEmpty() {
        // Own thread: a slow HRMS sweep must not block application startup.
        new Thread(() -> {
            try {
                if (projectionRepository.isEmpty()) {
                    log.info("HRMS projection empty — running boot-time backfill");
                    rebuildProjection();
                }
            } catch (Exception e) {
                log.error("HRMS projection boot backfill failed (nightly rebuild will retry)", e);
            }
        }, "hrms-projection-backfill").start();
    }

    /**
     * Full sweep of HRMS for the state-level tenant (employees are registered
     * at the state tenant in the reference deploys; the reportee query also
     * matches city rows). Paged via limit/offset until a short page.
     */
    public synchronized void rebuildProjection() {
        RequestInfoWrapper wrapper = RequestInfoWrapper.builder().requestInfo(systemRequestInfo()).build();
        int offset = 0;
        int total = 0;
        try {
            while (true) {
                StringBuilder url = new StringBuilder(config.getHrmsHost())
                        .append(config.getHrmsEndPoint())
                        .append("?tenantId=").append(stateLevelTenantId)
                        .append("&limit=").append(rebuildBatchSize)
                        .append("&offset=").append(offset);

                Object res = serviceRequestRepository.fetchResult(url, wrapper);
                JsonNode employees = mapper.valueToTree(res).path("Employees");
                if (!employees.isArray() || employees.size() == 0) {
                    break;
                }
                for (JsonNode employee : employees) {
                    projectEmployee(employee);
                    total++;
                }
                if (employees.size() < rebuildBatchSize) {
                    break;
                }
                offset += rebuildBatchSize;
            }
            log.info("HRMS projection rebuild complete: {} employees projected for tenant {}", total, stateLevelTenantId);
        } catch (Exception e) {
            log.error("HRMS projection rebuild failed after {} rows (tenant {})", total, stateLevelTenantId, e);
        }
    }

    private RequestInfo systemRequestInfo() {
        // Same SYSTEM identity the escalation scheduler uses for internal calls.
        User systemUser = User.builder()
                .uuid(config.getEgovInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .roles(Collections.singletonList(
                        Role.builder().code("SYSTEM").name("System").tenantId(stateLevelTenantId).build()))
                .build();
        return RequestInfo.builder()
                .apiId("Rainmaker").ver(".01").msgId("20170310130900|en_IN")
                .authToken("").userInfo(systemUser)
                .build();
    }

    private String firstNonBlank(String a, String b) {
        if (a != null && !a.isEmpty()) return a;
        return (b != null && !b.isEmpty()) ? b : null;
    }
}
