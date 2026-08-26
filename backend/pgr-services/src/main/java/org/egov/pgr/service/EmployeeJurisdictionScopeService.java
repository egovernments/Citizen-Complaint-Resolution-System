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
 * Restricts an EMPLOYEE's complaint search to the jurisdiction (boundary) they belong to in
 * HRMS — but only for callers holding a role in {@link PGRConfiguration#getJurisdictionScopeRoles()}
 * (configurable via {@code pgr.jurisdiction.scope.roles}, empty by default). Opt-in: every other
 * employee role is unrestricted, unchanged from pre-existing behavior — so upgrading with the
 * default (empty) config is a no-op.
 *
 * Filters directly on the complaint's stored {@code ads.locality} — an exact boundary-code match
 * only, no subtree/hierarchy expansion (see PGRQueryBuilder; live PGR search has no ancestor-path
 * column, unlike the analytics materialized views).
 *
 * CITIZEN search is untouched — this is only ever invoked for USERTYPE_EMPLOYEE callers.
 */
@Service
@Slf4j
public class EmployeeJurisdictionScopeService {

    private final HRMSUtil hrmsUtil;
    private final PGRConfiguration config;

    @Autowired
    public EmployeeJurisdictionScopeService(HRMSUtil hrmsUtil, PGRConfiguration config) {
        this.hrmsUtil = hrmsUtil;
        this.config = config;
    }

    /**
     * The flow, in order: (1) a caller who does NOT hold a role in pgr.jurisdiction.scope.roles is
     * unrestricted — sees every jurisdiction; (2) otherwise, fetch the caller's jurisdiction from
     * HRMS — none found means show nothing; (3) otherwise, restrict {@code criteria} to that
     * jurisdiction's complaints. Returns false whenever the caller must see nothing, so the caller
     * can skip the DB query entirely.
     */
    public boolean applyScope(RequestInfo requestInfo, String tenantId, RequestSearchCriteria criteria) {
        User user = requestInfo.getUserInfo();

        // (1) opt-in — only roles in pgr.jurisdiction.scope.roles get scoped at all.
        if (!hasAnyRole(user, config.getJurisdictionScopeRoles()))
            return true;

        // (2) fetch the employee's jurisdiction boundary code(s) from HRMS. None resolved -> show nothing.
        Set<String> boundaryCodes = fetchJurisdictions(requestInfo, tenantId, user);
        if (boundaryCodes.isEmpty())
            return false;

        // (3) restrict criteria to complaints filed under that exact boundary code.
        criteria.setJurisdictionBoundaryCodes(boundaryCodes);
        return true;
    }

    /**
     * Pure HRMS jurisdiction lookup for this one employee. Empty (never null) if unresolved.
     */
    private Set<String> fetchJurisdictions(RequestInfo requestInfo, String tenantId, User user) {
        try {
            List<String> jurisdictions = hrmsUtil.getCurrentJurisdiction(user.getUuid(), requestInfo, tenantId);
            return CollectionUtils.isEmpty(jurisdictions) ? Collections.emptySet() : new LinkedHashSet<>(jurisdictions);
        } catch (Exception e) {
            // hrmsUtil.getCurrentJurisdiction already logs (at WARN) the ordinary "employee has no
            // jurisdiction" case internally without throwing. Reaching this catch means the HRMS
            // call itself failed (network/HTTP/outage) — log loudly so a scoped role going silently
            // empty during an HRMS incident is visible, not mistaken for "no complaints".
            log.error("Jurisdiction scope: HRMS call FAILED for uuid='{}', tenant='{}' — denying "
                    + "search (fail-closed). This denies real results if HRMS is down; investigate "
                    + "immediately if scoped-role searches are unexpectedly empty.", user.getUuid(), tenantId, e);
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
