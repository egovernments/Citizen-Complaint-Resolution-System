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

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.egov.pgr.util.PGRConstants.ESCALATE;

@Component
@Slf4j
public class EscalationScheduler {

    private final PGRConfiguration config;
    private final PGRRepository repository;
    private final EscalationService escalationService;
    private final EscalationConfigurationService configurationService;
    private final PGRService pgrService;

    @Value("${state.level.tenant.id:${egov.state.level.tenant.id:ke}}")
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

        List<String> stateTenants = configurationService.resolveStateTenants(systemRequestInfo, tenantId);
        boolean exactTenantScan = !stateTenants.isEmpty();
        Map<String, EscalationConfigurationService.ResolvedEscalationConfig> policyCache = new HashMap<>();
        ScanResult total = new ScanResult();
        if (exactTenantScan) {
            for (String scanTenant : stateTenants) {
                EscalationConfigurationService.ResolvedEscalationConfig policy =
                        policyFor(scanTenant, systemRequestInfo, policyCache);
                for (String status : policy.getEligibleStatuses()) {
                    total.add(scan(scanTenant, status, true, systemRequestInfo, policyCache));
                }
            }
        } else {
            // Discovery failure changes only how complaints are found. Every returned complaint
            // is still evaluated against the policy resolved for its own tenant.
            total.add(scan(tenantId, null, false, systemRequestInfo, policyCache));
        }

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}",
                total.scanned, total.escalated, total.skipped);
    }

    private ScanResult scan(String scanTenant, String status, boolean exactTenantScan,
                            RequestInfo systemRequestInfo,
                            Map<String, EscalationConfigurationService.ResolvedEscalationConfig> policyCache) {
        ScanResult result = new ScanResult();
        int offset = 0;
        while (true) {
            List<ServiceWrapper> complaints;
            try {
                complaints = searchComplaintsByStatus(scanTenant, status, offset, exactTenantScan);
            } catch (Exception e) {
                log.error("Error scanning complaints in status {} for tenant {}", status, scanTenant, e);
                break;
            }
            if (complaints.isEmpty()) {
                break;
            }

            for (ServiceWrapper wrapper : complaints) {
                result.scanned++;
                Service complaint = wrapper.getService();
                EscalationConfigurationService.ResolvedEscalationConfig escalationConfig =
                        policyFor(complaint.getTenantId(), systemRequestInfo, policyCache);
                if (complaint.getApplicationStatus() == null
                        || !escalationConfig.getEligibleStatuses().contains(
                                complaint.getApplicationStatus().toUpperCase(Locale.ROOT))) {
                    result.skipped++;
                    continue;
                }
                int currentLevel = escalationService.escalationLevel(complaint);
                if (currentLevel >= escalationConfig.effectiveMaxDepth(complaint.getServiceCode())
                        || !escalationConfig.isEnabled(complaint.getServiceCode(), currentLevel)) {
                    result.skipped++;
                    continue;
                }

                long complaintCreatedAt = escalationService.escalationWindowStartedAt(complaint);
                if (complaintCreatedAt <= 0) {
                    result.skipped++;
                    continue;
                }
                long sla = escalationConfig.resolveSla(complaint.getServiceCode(), currentLevel);
                if (System.currentTimeMillis() - complaintCreatedAt < sla) {
                    continue;
                }

                try {
                    ServiceRequest escalationRequest = ServiceRequest.builder()
                            .requestInfo(systemRequestInfo)
                            .service(complaint)
                            .workflow(Workflow.builder()
                                    .action(ESCALATE)
                                    .comments("Auto-escalated after complaint SLA threshold at level " + currentLevel)
                                    .build())
                            .build();
                    pgrService.updateAutomaticEscalation(escalationRequest);
                    result.escalated++;
                } catch (Exception e) {
                    result.skipped++;
                    log.warn("Complaint {} was due but could not be escalated: {}",
                            complaint.getServiceRequestId(), e.getMessage());
                }
            }

            if (complaints.size() < config.getEscalationBatchSize()) {
                break;
            }
            offset += complaints.size();
        }
        return result;
    }

    private EscalationConfigurationService.ResolvedEscalationConfig policyFor(
            String tenantId, RequestInfo requestInfo,
            Map<String, EscalationConfigurationService.ResolvedEscalationConfig> cache) {
        return cache.computeIfAbsent(tenantId, key -> configurationService.resolve(requestInfo, key));
    }

    private List<ServiceWrapper> searchComplaintsByStatus(String tenantId, String status, int offset,
                                                          boolean exactTenantScan) {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .tenantIds(exactTenantScan ? Collections.singleton(tenantId) : null)
                .applicationStatus(status == null ? null : Collections.singleton(status))
                .limit(config.getEscalationBatchSize())
                .offset(offset)
                // Exact scans pin tenantIds. Discovery fallback uses the normal
                // state-root tenant predicate; a plain search without tenantIds
                // would accidentally scan every state in a shared database.
                .isPlainSearch(exactTenantScan)
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
        return stateLevelTenantId == null || stateLevelTenantId.isBlank() ? null : stateLevelTenantId;
    }

    private static final class ScanResult {
        private int scanned;
        private int escalated;
        private int skipped;

        private void add(ScanResult other) {
            scanned += other.scanned;
            escalated += other.escalated;
            skipped += other.skipped;
        }
    }
}
