package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.onboarding.WorkspaceRepository;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static org.egov.pgr.util.PGRConstants.ESCALATE;

@Component
@Slf4j
public class EscalationScheduler {

    private final PGRConfiguration config;
    private final PGRRepository repository;
    private final EscalationService escalationService;
    private final EscalationConfigurationService configurationService;
    private final PGRService pgrService;
    private final WorkspaceRepository workspaces;

    @Value("${state.level.tenant.id:${egov.state.level.tenant.id:ke}}")
    private String stateLevelTenantId;

    @Autowired
    public EscalationScheduler(PGRConfiguration config,
                               PGRRepository repository,
                               EscalationService escalationService,
                               EscalationConfigurationService configurationService,
                               PGRService pgrService,
                               WorkspaceRepository workspaces) {
        this.config = config;
        this.repository = repository;
        this.escalationService = escalationService;
        this.configurationService = configurationService;
        this.pgrService = pgrService;
        this.workspaces = workspaces;
    }

    @Scheduled(fixedDelayString = "${pgr.escalation.interval.ms}")
    public void scanAndEscalate() {
        if (!Boolean.TRUE.equals(config.getEscalationEnabled())) {
            return;
        }

        Set<String> scanTenants = new LinkedHashSet<>(discoverStateTenants());
        // Onboarded root tenants are not listed under the state tenant. Scan each one once its signup is
        // ACTIVE, whatever its workspace checklist says: IN_PROGRESS or reopened setups still take complaints.
        try {
            scanTenants.addAll(workspaces.onboardedTenantIds());
        } catch (Exception e) {
            log.error("Could not list onboarded workspace tenants; scanning state tenants only", e);
        }
        if (scanTenants.isEmpty()) {
            log.warn("No tenants discovered; skipping escalation scan");
            return;
        }

        log.info("Escalation scan started for tenants {}", scanTenants);
        Map<String, EscalationConfigurationService.ResolvedEscalationConfig> policyCache = new HashMap<>();
        ScanResult total = new ScanResult();
        for (String scanTenant : scanTenants) {
            // workflow-v2 only honours a role whose tenantId matches (or prefixes) the complaint's tenant.
            RequestInfo systemRequestInfo = buildSystemRequestInfo(scanTenant);
            try {
                EscalationConfigurationService.ResolvedEscalationConfig policy =
                        policyFor(scanTenant, systemRequestInfo, policyCache);
                for (String status : policy.getEligibleStatuses()) {
                    total.add(scan(scanTenant, status, systemRequestInfo, policyCache));
                }
            } catch (Exception e) {
                log.error("Could not resolve escalation policy for tenant {}; skipping it", scanTenant, e);
            }
        }

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}",
                total.scanned, total.escalated, total.skipped);
    }

    private ScanResult scan(String scanTenant, String status,
                            RequestInfo systemRequestInfo,
                            Map<String, EscalationConfigurationService.ResolvedEscalationConfig> policyCache) {
        ScanResult result = new ScanResult();
        Long createdTimeBefore = null;
        String serviceRequestIdBefore = null;
        while (true) {
            List<ServiceWrapper> complaints;
            try {
                complaints = searchComplaintsByStatus(
                        scanTenant, status, createdTimeBefore, serviceRequestIdBefore);
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
                try {
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
                        result.skipped++;
                        continue;
                    }

                    // Consult workflow history only once metadata says the complaint is due.
                    // This recovers from a workflow-success/persistence-lag split without adding
                    // a history request for every not-yet-due complaint on every scan.
                    currentLevel = escalationService.reconciledEscalationLevel(
                            complaint, systemRequestInfo);
                    if (currentLevel >= escalationConfig.effectiveMaxDepth(complaint.getServiceCode())
                            || !escalationConfig.isEnabled(complaint.getServiceCode(), currentLevel)
                            || System.currentTimeMillis() - complaintCreatedAt
                            < escalationConfig.resolveSla(complaint.getServiceCode(), currentLevel)) {
                        result.skipped++;
                        continue;
                    }

                    // Any configured state still needs a concrete workflow assignee. Skip
                    // unassigned complaints before the full update pipeline.
                    List<String> currentAssignees = escalationService.getCurrentAssignees(
                            complaint.getServiceRequestId(), complaint.getTenantId(), systemRequestInfo);
                    if (currentAssignees.isEmpty()
                            || !escalationService.hasReportingTo(
                                    currentAssignees, systemRequestInfo, complaint.getTenantId())) {
                        result.skipped++;
                        continue;
                    }

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
            Service last = complaints.get(complaints.size() - 1).getService();
            if (last.getAuditDetails() == null || last.getAuditDetails().getCreatedTime() == null
                    || last.getServiceRequestId() == null) {
                log.error("Cannot continue stable escalation scan after complaint {} in tenant {}",
                        last.getServiceRequestId(), scanTenant);
                break;
            }
            createdTimeBefore = last.getAuditDetails().getCreatedTime();
            serviceRequestIdBefore = last.getServiceRequestId();
        }
        return result;
    }

    private List<String> discoverStateTenants() {
        String tenantId = getStateLevelTenantId();
        if (tenantId == null) {
            log.warn("Cannot determine state-level tenant ID; scanning onboarded workspaces only");
            return Collections.emptyList();
        }
        List<String> stateTenants = configurationService.resolveStateTenants(buildSystemRequestInfo(tenantId), tenantId);
        if (!stateTenants.isEmpty()) {
            return stateTenants;
        }
        try {
            stateTenants = repository.getComplaintTenantIds(tenantId);
            log.warn("Tenant-master discovery failed; scanning complaint tenants {}", stateTenants);
            return stateTenants;
        } catch (Exception e) {
            log.error("Both tenant-master and complaint-tenant discovery failed for {}", tenantId, e);
            return Collections.emptyList();
        }
    }

    private EscalationConfigurationService.ResolvedEscalationConfig policyFor(
            String tenantId, RequestInfo requestInfo,
            Map<String, EscalationConfigurationService.ResolvedEscalationConfig> cache) {
        return cache.computeIfAbsent(tenantId, key -> configurationService.resolve(requestInfo, key));
    }

    private List<ServiceWrapper> searchComplaintsByStatus(String tenantId, String status,
                                                          Long createdTimeBefore,
                                                          String serviceRequestIdBefore) {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .tenantIds(Collections.singleton(tenantId))
                .applicationStatus(Collections.singleton(status))
                .limit(config.getEscalationBatchSize())
                .offset(0)
                .sortBy(RequestSearchCriteria.SortBy.createdTime)
                .sortOrder(RequestSearchCriteria.SortOrder.DESC)
                .createdTimeBefore(createdTimeBefore)
                .serviceRequestIdBefore(serviceRequestIdBefore)
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
