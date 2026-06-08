package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.Workflow;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.*;

import static org.egov.pgr.util.PGRConstants.PENDINGATLME;
import static org.egov.pgr.util.PGRConstants.PENDINGFORASSIGNMENT;

@Component
@Slf4j
@RequiredArgsConstructor
public class EscalationScheduler {

    private final PGRConfiguration config;
    private final RegistryService registryService;
    private final EscalationService escalationService;
    private final ObjectMapper mapper;

    @Scheduled(fixedDelayString = "${pgr.escalation.interval.ms}")
    public void scanAndEscalate() {
        if (!Boolean.TRUE.equals(config.getEscalationEnabled())) return;

        log.info("Escalation scan started");

        String tenantId = resolveTenantId();
        if (tenantId == null) {
            log.warn("No tenant ID found, skipping escalation scan");
            return;
        }

        int scanned = 0, escalated = 0, skipped = 0;

        for (String status : List.of(PENDINGATLME, PENDINGFORASSIGNMENT)) {
            try {
                List<ServiceWrapper> complaints = fetchByStatus(tenantId, status);

                for (ServiceWrapper wrapper : complaints) {
                    scanned++;
                    Service complaint = wrapper.getService();

                    int level = getEscalationLevel(complaint);
                    if (level >= config.getEscalationMaxDepth()) { skipped++; continue; }

                    long lastModified = resolveLastModified(complaint);
                    if (lastModified == 0L) { skipped++; continue; }

                    long elapsed = System.currentTimeMillis() - lastModified;
                    if (elapsed < config.getEscalationDefaultSlaMs()) continue;

                    // Assignees are tracked in additionalDetail by the previous escalation step
                    Workflow currentWorkflow = Workflow.builder().assignes(Collections.emptyList()).build();
                    boolean success = escalationService.escalateComplaint(complaint, currentWorkflow);
                    if (success) escalated++; else skipped++;
                }
            } catch (Exception e) {
                log.error("Error scanning complaints in status {} for tenant {}", status, tenantId, e);
            }
        }

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}", scanned, escalated, skipped);
    }

    private List<ServiceWrapper> fetchByStatus(String tenantId, String status) {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .applicationStatus(Collections.singleton(status))
                .limit(config.getEscalationBatchSize())
                .offset(0)
                .isPlainSearch(true)
                .build();

        List<Service> services = registryService.search(criteria);
        List<ServiceWrapper> wrappers = new ArrayList<>();
        for (Service svc : services) {
            wrappers.add(ServiceWrapper.builder().service(svc).workflow(new Workflow()).build());
        }
        return wrappers;
    }

    private String resolveTenantId() {
        Map<String, String> hostMap = config.getUiAppHostMap();
        if (hostMap != null && !hostMap.isEmpty()) return hostMap.keySet().iterator().next();
        return config.getTenantId();
    }

    private long resolveLastModified(Service complaint) {
        if (complaint.getAuditDetails() == null) return 0L;
        Long modified = complaint.getAuditDetails().getLastModifiedTime();
        if (modified != null && modified > 0) return modified;
        Long created = complaint.getAuditDetails().getCreatedTime();
        return created != null ? created : 0L;
    }

    @SuppressWarnings("unchecked")
    private int getEscalationLevel(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) return 0;
        try {
            Map<String, Object> details = additionalDetail instanceof Map
                    ? (Map<String, Object>) additionalDetail
                    : mapper.convertValue(additionalDetail, Map.class);
            Object level = details.get("escalationLevel");
            if (level instanceof Number) return ((Number) level).intValue();
        } catch (Exception ignored) {}
        return 0;
    }
}
