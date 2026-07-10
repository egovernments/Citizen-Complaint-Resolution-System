package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Restricts an EMPLOYEE's complaint search to the department(s) they belong to in HRMS, unless
 * they hold a role in {@link PGRConfiguration#getDepartmentScopeBypassRoles()} (configurable via
 * {@code pgr.department.scope.bypass.roles}) — the same config-driven list that gates the
 * analytics row-scope in {@link org.egov.pgr.analytics.PrincipalScopeResolver}, so the two stay
 * consistent.
 *
 * Filters directly on the complaint's stored {@code additionalDetails.department} field, matching
 * the employee's raw HRMS department code as-is — no MDMS name resolution. In practice this field
 * is populated with the raw code (or "NA"), so code-to-code matching is what actually works.
 *
 * CITIZEN search is untouched — this is only ever invoked for USERTYPE_EMPLOYEE callers.
 */
@Service
@Slf4j
public class EmployeeDepartmentScopeService {

    private final HRMSUtil hrmsUtil;
    private final PGRConfiguration config;

    @Autowired
    public EmployeeDepartmentScopeService(HRMSUtil hrmsUtil, PGRConfiguration config) {
        this.hrmsUtil = hrmsUtil;
        this.config = config;
    }

    /**
     * The flow, in order: (1) a caller holding a bypass role sees every department, unrestricted;
     * (2) otherwise, fetch the caller's department from HRMS — none found means show nothing;
     * (3) otherwise, restrict {@code criteria} to that department's complaints. Returns false
     * whenever the caller must see nothing, so the caller can skip the DB query entirely.
     */
    public boolean applyScope(RequestInfo requestInfo, String tenantId, RequestSearchCriteria criteria) {
        User user = requestInfo.getUserInfo();

        // (1) escape hatch — roles in pgr.department.scope.bypass.roles see every department.
        if (hasAnyRole(user, config.getDepartmentScopeBypassRoles()))
            return true;

        // (2) fetch the employee's department(s) from HRMS. None resolved -> show nothing.
        Set<String> departments = fetchDepartments(requestInfo, tenantId, user);
        if (departments.isEmpty())
            return false;

        // (3) restrict criteria to complaints stored under that department code.
        criteria.setDepartmentCodes(departments);
        return true;
    }

    /**
     * Pure HRMS department lookup for this one employee — CURRENT assignment(s) only, so a past
     * (ended) assignment can't widen access. Empty (never null) if unresolved.
     */
    private Set<String> fetchDepartments(RequestInfo requestInfo, String tenantId, User user) {
        try {
            List<String> departments = hrmsUtil.getCurrentDepartment(user.getUuid(), requestInfo, tenantId);
            return CollectionUtils.isEmpty(departments) ? Collections.emptySet() : new LinkedHashSet<>(departments);
        } catch (Exception e) {
            log.info("Department scope: could not resolve HRMS department for uuid='{}', tenant='{}' "
                    + "— denying search (fail-closed)", user.getUuid(), tenantId, e);
            return Collections.emptySet();
        }
    }

    private boolean hasAnyRole(User user, List<String> roleCodes) {
        if (user == null || user.getRoles() == null) return false;
        return user.getRoles().stream()
                .anyMatch(r -> r != null && r.getCode() != null
                        && roleCodes.stream().anyMatch(r.getCode()::equalsIgnoreCase));
    }
}
