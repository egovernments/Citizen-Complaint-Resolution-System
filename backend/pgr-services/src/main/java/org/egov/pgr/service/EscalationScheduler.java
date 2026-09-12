package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.Workflow;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.egov.pgr.util.PGRConstants.ESCALATE;
import static org.egov.pgr.util.PGRConstants.PENDINGATLME;
import static org.egov.pgr.util.PGRConstants.PENDINGFORASSIGNMENT;

@Component
@Slf4j
public class EscalationScheduler {

    private final PGRConfiguration config;
    private final PGRRepository repository;
    private final EscalationService escalationService;
    private final EscalationConfigurationService configurationService;
    private final PGRService pgrService;

    @Value("${egov.state.level.tenant.id:ke}")
    private String stateLevelTenantId;

    @Autowired
    public EscalationScheduler(PGRConfiguration config,
                               PGRRepository repository,
                               EscalationService escalationService,
                               EscalationConfigurationService configurationService,
                               PGRService pgrService) {
        this.config = config;
        this.repository = repository;
        this.escalationService = escalationService;
        this.configurationService = configurationService;
        this.pgrService = pgrService;
    }

    @Scheduled(fixedDelayString = "${pgr.escalation.interval.ms}")
    public void scanAndEscalate() {
        if (!Boolean.TRUE.equals(config.getEscalationEnabled())) {
            return;
        }

        String tenantId = getStateLevelTenantId();
        if (tenantId == null) {
            log.warn("Cannot determine state-level tenant ID; skipping escalation scan");
            return;
        }

        log.info("Escalation scan started for tenant {}", tenantId);
        RequestInfo systemRequestInfo = buildSystemRequestInfo(tenantId);
        EscalationConfigurationService.ResolvedEscalationConfig escalationConfig =
                configurationService.resolve(systemRequestInfo, tenantId);

        int scanned = 0;
        int escalated = 0;
        int skipped = 0;
        for (String status : Arrays.asList(PENDINGATLME, PENDINGFORASSIGNMENT)) {
            int offset = 0;
            while (true) {
                List<ServiceWrapper> complaints;
                try {
                    complaints = searchComplaintsByStatus(tenantId, status, offset);
                } catch (Exception e) {
                    log.error("Error scanning complaints in status {} for tenant {}", status, tenantId, e);
                    break;
                }
                if (complaints.isEmpty()) {
                    break;
                }

                for (ServiceWrapper wrapper : complaints) {
                    scanned++;
                    Service complaint = wrapper.getService();
                    int currentLevel = escalationService.escalationLevel(complaint);
                    if (currentLevel >= escalationConfig.getMaxDepth()
                            || !escalationConfig.isEnabled(complaint.getServiceCode(), currentLevel)) {
                        skipped++;
                        continue;
                    }

                    long windowStartedAt = escalationService.escalationWindowStartedAt(complaint);
                    if (windowStartedAt <= 0) {
                        skipped++;
                        continue;
                    }
                    long sla = escalationConfig.resolveSla(complaint.getServiceCode(), currentLevel);
                    if (System.currentTimeMillis() - windowStartedAt < sla) {
                        continue;
                    }

                    try {
                        ServiceRequest escalationRequest = ServiceRequest.builder()
                                .requestInfo(systemRequestInfo)
                                .service(complaint)
                                .workflow(Workflow.builder()
                                        .action(ESCALATE)
                                        .comments("Auto-escalated after SLA breach at level " + currentLevel)
                                        .build())
                                .build();
                        // This is deliberately the same entry point used by manual ESCALATE.
                        pgrService.update(escalationRequest);
                        escalated++;
                    } catch (Exception e) {
                        skipped++;
                        log.warn("Complaint {} was due but could not be escalated: {}",
                                complaint.getServiceRequestId(), e.getMessage());
                    }
                }

                // batch.size is a page size, not a cap: scan every page in this run.
                if (complaints.size() < config.getEscalationBatchSize()) {
                    break;
                }
                offset += complaints.size();
            }
        }

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}",
                scanned, escalated, skipped);
    }

    private List<ServiceWrapper> searchComplaintsByStatus(String tenantId, String status, int offset) {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .applicationStatus(Collections.singleton(status))
                .limit(config.getEscalationBatchSize())
                .offset(offset)
                .isPlainSearch(true)
                .build();
        return repository.getServiceWrappers(criteria);
    }

    private RequestInfo buildSystemRequestInfo(String tenantId) {
        User systemUser = User.builder()
                .uuid(config.getEgovInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .roles(Collections.singletonList(
                        Role.builder().code("SYSTEM").name("System").tenantId(tenantId).build()
                ))
                .build();

        return RequestInfo.builder()
                .apiId("Rainmaker")
                .ver(".01")
                .ts(null)
                .action("")
                .did("1")
                .key("")
                .msgId("20170310130900|en_IN")
                .authToken("")
                .userInfo(systemUser)
                .build();
    }

    private String getStateLevelTenantId() {
        Map<String, String> hostMap = config.getUiAppHostMap();
        if (hostMap != null && !hostMap.isEmpty()) {
            return hostMap.keySet().iterator().next();
        }
        return stateLevelTenantId == null || stateLevelTenantId.isBlank() ? null : stateLevelTenantId;
    }
}
