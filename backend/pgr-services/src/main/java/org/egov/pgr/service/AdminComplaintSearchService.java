package org.egov.pgr.service;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.AdminSearchCriteria;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import org.springframework.util.CollectionUtils;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Backs the new {@code POST /pgr-services/v2/request/_admin/_search} endpoint (the SUPERUSER
 * cross-department search page — see docs/complaint-search-page.md). Delegates to the existing,
 * unmodified {@link PGRService#search} / {@link PGRService#count}: this class adds no query
 * -building logic of its own beyond resolving the department filter, so the pre-existing
 * {@code _search}/{@code _count} endpoints and the PGRQueryBuilder path they share are completely
 * untouched by this feature.
 */
@Service
@Slf4j
public class AdminComplaintSearchService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final PGRService pgrService;
    private final MDMSUtils mdmsUtils;

    @Autowired
    public AdminComplaintSearchService(PGRService pgrService, MDMSUtils mdmsUtils) {
        this.pgrService = pgrService;
        this.mdmsUtils = mdmsUtils;
    }

    public Result search(RequestInfo requestInfo, AdminSearchCriteria adminCriteria) {
        if (adminCriteria.getTenantId() == null)
            throw new CustomException("INVALID_SEARCH", "tenantId is mandatory search param");

        RequestSearchCriteria criteria = toRequestSearchCriteria(adminCriteria);
        List<ServiceWrapper> serviceWrappers = pgrService.search(requestInfo, criteria);
        Integer totalCount = pgrService.count(requestInfo, criteria);
        return new Result(serviceWrappers, totalCount);
    }

    private RequestSearchCriteria toRequestSearchCriteria(AdminSearchCriteria adminCriteria) {
        int limit = adminCriteria.getLimit() == null
                ? DEFAULT_LIMIT : Math.min(adminCriteria.getLimit(), MAX_LIMIT);
        int offset = adminCriteria.getOffset() == null ? 0 : adminCriteria.getOffset();

        RequestSearchCriteria.SortBy sortBy = adminCriteria.getSortBy() == null
                ? RequestSearchCriteria.SortBy.createdTime : adminCriteria.getSortBy();
        RequestSearchCriteria.SortOrder sortOrder = adminCriteria.getSortOrder() == null
                ? RequestSearchCriteria.SortOrder.DESC : adminCriteria.getSortOrder();

        RequestSearchCriteria.RequestSearchCriteriaBuilder builder = RequestSearchCriteria.builder()
                .tenantId(adminCriteria.getTenantId())
                .serviceRequestId(adminCriteria.getServiceRequestId())
                .fromDate(adminCriteria.getFromDate())
                .toDate(adminCriteria.getToDate())
                .sortBy(sortBy)
                .sortOrder(sortOrder)
                .limit(limit)
                .offset(offset)
                // This SUPERUSER search's own department filter (below) must never be overwritten
                // by PGRService#applyEmployeeDepartmentScope, which would otherwise substitute the
                // caller's own HRMS department if they also hold a role in
                // pgr.department.scope.roles — see RequestSearchCriteria#skipEmployeeDepartmentScope.
                .skipEmployeeDepartmentScope(true);

        if (!CollectionUtils.isEmpty(adminCriteria.getDepartmentCode()))
            builder.departmentCodes(resolveDepartmentCodes(adminCriteria.getTenantId(), adminCriteria.getDepartmentCode()));

        return builder.build();
    }

    /**
     * Matches directly on the complaint's stored {@code additionaldetails.department} (the
     * existing PGRQueryBuilder clause also used by EmployeeDepartmentScopeService) instead of
     * resolving through ComplaintHierarchy's per-service-type department tagging. That detour
     * would miss any complaint stored with the "NA" unresolved sentinel, or whose serviceCode
     * ComplaintHierarchy hasn't (yet) tagged with a department — both are real, not hypothetical,
     * given PGRService#getDepartmentFromMDMS's fallback behavior.
     *
     * Each selected department may be given as its MDMS code or its name; both forms are matched
     * (mirroring EmployeeDepartmentScopeService's handling of the same code/name ambiguity), and
     * multiple departments are OR'd together via the existing IN (...) clause.
     */
    private Set<String> resolveDepartmentCodes(String tenantId, Set<String> departments) {
        Set<String> departmentCodes = new LinkedHashSet<>();
        Map<String, String> codeToName = mdmsUtils.getDepartmentCodeToNameMap(tenantId);

        for (String department : departments) {
            departmentCodes.add(department);
            String name = codeToName.get(department);
            if (name != null) {
                departmentCodes.add(name);
            } else {
                codeToName.entrySet().stream()
                        .filter(e -> e.getValue().equalsIgnoreCase(department))
                        .findFirst()
                        .ifPresent(e -> departmentCodes.add(e.getKey()));
            }
        }
        return departmentCodes;
    }

    @Getter
    public static class Result {
        private final List<ServiceWrapper> serviceWrappers;
        private final Integer totalCount;

        public Result(List<ServiceWrapper> serviceWrappers, Integer totalCount) {
            this.serviceWrappers = serviceWrappers;
            this.totalCount = totalCount;
        }
    }
}
