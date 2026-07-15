package org.egov.pgr.service;

import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.mdms.model.MasterDetail;
import org.egov.mdms.model.MdmsCriteria;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.mdms.model.ModuleDetail;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.HrmsProjectionRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.egov.pgr.util.PGRConstants.MDMS_INBOX_VISIBILITY_CONFIG_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_MODULE_NAME;
import static org.egov.pgr.util.PGRConstants.MDMS_INBOX_VISIBILITY_CONFIG;

/**
 * Server-side visibility resolver for the PGR inbox tabs (Visibility V1
 * Step-2 reportee core, VISIBILITY-DESIGN.md §4.2).
 *
 * MY  -> assignee = the acting user (PGRService.search/count already resolve
 *        the assignee through workflow).
 * ALL -> for a user with reportees in the HRMS projection: complaints
 *        assigned to them or their reportee subtree, PLUS the unassigned
 *        queues (states where no assignee exists yet). For everyone else —
 *        including supervisors whose reportingTo data is unmaintained — ALL
 *        degrades to the tenant-wide open view rather than an empty tab.
 *
 * Gated twice: the PGR_VISIBILITY_ENABLED env kill switch (service-wide) and
 * the per-tenant MDMS RAINMAKER-PGR.InboxVisibilityConfig `enabled` flag —
 * the same record the frontend decides from, so flag-off tenants never reach
 * this code path end-to-end.
 */
@Slf4j
@Service
public class VisibilityService {

    public static final String TAB_MY = "MY";
    public static final String TAB_ALL = "ALL";

    private final PGRConfiguration config;
    private final HrmsProjectionRepository projectionRepository;
    private final WorkflowService workflowService;
    private final ServiceRequestRepository serviceRequestRepository;
    private final org.egov.pgr.util.MDMSUtils mdmsUtils;

    @Autowired
    public VisibilityService(PGRConfiguration config, HrmsProjectionRepository projectionRepository,
                             WorkflowService workflowService, ServiceRequestRepository serviceRequestRepository,
                             org.egov.pgr.util.MDMSUtils mdmsUtils) {
        this.config = config;
        this.projectionRepository = projectionRepository;
        this.workflowService = workflowService;
        this.serviceRequestRepository = serviceRequestRepository;
        this.mdmsUtils = mdmsUtils;
    }

    /** Mutates the criteria with the tab's visibility scope. */
    public void resolve(RequestInfo requestInfo, RequestSearchCriteria criteria, String tab) {
        if (!Boolean.TRUE.equals(config.getVisibilityEnabled())) {
            throw new CustomException("PGR_VISIBILITY_DISABLED",
                    "Inbox visibility resolution is disabled on this deployment (PGR_VISIBILITY_ENABLED)");
        }

        String tenantId = criteria.getTenantId() != null ? criteria.getTenantId()
                : requestInfo.getUserInfo().getTenantId();
        Map<String, Object> mdmsConfig = fetchVisibilityConfig(requestInfo, tenantId);
        if (mdmsConfig == null || !Boolean.TRUE.equals(mdmsConfig.get("enabled"))) {
            throw new CustomException("PGR_VISIBILITY_DISABLED",
                    "Inbox visibility is not enabled for tenant " + tenantId + " (RAINMAKER-PGR.InboxVisibilityConfig)");
        }

        String me = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;
        if (me == null) {
            throw new CustomException("PGR_VISIBILITY_NO_USER", "Inbox visibility requires an authenticated user");
        }

        if (TAB_MY.equalsIgnoreCase(tab)) {
            criteria.setAssignee(me);
            return;
        }
        if (!TAB_ALL.equalsIgnoreCase(tab)) {
            throw new CustomException("PGR_VISIBILITY_INVALID_TAB", "Unknown inbox tab: " + tab);
        }

        int depth = readDepth(mdmsConfig);
        Set<String> reportees = projectionRepository.getReporteeUuids(tenantId, me, depth);
        if (CollectionUtils.isEmpty(reportees)) {
            // Fallback rule (design §4.2): no projected reportees — whether the
            // user is a leaf employee or the reportingTo data is unmaintained —
            // means ALL stays the tenant-wide open view, never an empty tab.
            return;
        }

        Set<String> team = new HashSet<>(reportees);
        team.add(me);
        Set<String> assignedIds = new HashSet<>();
        for (String memberUuid : team) {
            assignedIds.addAll(workflowService.getServiceRequestIdsByAssignee(requestInfo, tenantId, memberUuid));
        }

        criteria.setVisibilityIds(assignedIds);
        criteria.setVisibilityUnassignedStates(new HashSet<>(config.getVisibilityUnassignedStates()));
        log.debug("Visibility ALL for {}: {} reportees, {} assigned complaints", me, reportees.size(), assignedIds.size());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchVisibilityConfig(RequestInfo requestInfo, String tenantId) {
        try {
            String stateTenant = tenantId.split("\\.")[0];
            ModuleDetail moduleDetail = ModuleDetail.builder()
                    .moduleName(MDMS_MODULE_NAME)
                    .masterDetails(Collections.singletonList(
                            MasterDetail.builder().name(MDMS_INBOX_VISIBILITY_CONFIG).build()))
                    .build();
            MdmsCriteriaReq req = MdmsCriteriaReq.builder()
                    .requestInfo(requestInfo)
                    .mdmsCriteria(MdmsCriteria.builder()
                            .tenantId(stateTenant)
                            .moduleDetails(Collections.singletonList(moduleDetail))
                            .build())
                    .build();
            Object result = serviceRequestRepository.fetchResult(mdmsUtils.getMdmsSearchUrl(), req);
            List<Map<String, Object>> configs = JsonPath.read(result, MDMS_INBOX_VISIBILITY_CONFIG_JSONPATH);
            return CollectionUtils.isEmpty(configs) ? null : configs.get(0);
        } catch (Exception e) {
            log.warn("Failed to fetch InboxVisibilityConfig for {} — treating as disabled", tenantId, e);
            return null;
        }
    }

    private int readDepth(Map<String, Object> mdmsConfig) {
        Object depth = mdmsConfig.get("reporteeDepth");
        if (depth instanceof Number) {
            int d = ((Number) depth).intValue();
            if (d >= 1) return d;
        }
        return config.getVisibilityReporteeDepthDefault();
    }
}
