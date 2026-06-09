package org.egov.pgr.analytics;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;

import java.util.List;

/**
 * Server-resolved RBAC scope. NEVER taken from the request body — derived from the
 * authenticated userInfo + tenantId. Clients can only narrow within this, never widen.
 *
 * - tenant scope: always applied (LIKE prefix at state level, = at city level).
 * - citizen self-scope: a pure CITIZEN sees only their own complaints (account_id = their uuid).
 * - boundary subtree scope: an employee restricted to a jurisdiction gets boundary_path LIKE.
 *   Full HRMS jurisdiction resolution is the documented extension point; for now an admin/employee
 *   is tenant-scoped and the boundary hook is wired but null unless a jurisdiction is supplied
 *   by the (server-trusted) caller context.
 */
public final class AnalyticsScope {
    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;     // nullable: set => restrict to this account
    public final String boundaryPrefix;  // nullable: set => boundary_path LIKE prefix||'%'

    private AnalyticsScope(String tenantId, boolean stateLevel, String citizenUuid, String boundaryPrefix){
        this.tenantId = tenantId; this.tenantStateLevel = stateLevel;
        this.citizenUuid = citizenUuid; this.boundaryPrefix = boundaryPrefix;
    }

    public static AnalyticsScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen){
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
        String citizenUuid = null;
        User u = requestInfo == null ? null : requestInfo.getUserInfo();
        if (u != null) {
            boolean isCitizen = "CITIZEN".equalsIgnoreCase(u.getType());
            boolean hasEmployeeRole = false;
            List<Role> roles = u.getRoles();
            if (roles != null) for (Role r : roles) {
                String c = r.getCode() == null ? "" : r.getCode().toUpperCase();
                if (!c.equals("CITIZEN")) hasEmployeeRole = true;
            }
            // a pure citizen is locked to their own records
            if (isCitizen && !hasEmployeeRole) citizenUuid = u.getUuid();
        }
        // boundaryPrefix: extension point for HRMS-jurisdiction-restricted employees (TODO).
        return new AnalyticsScope(tenantId, stateLevel, citizenUuid, null);
    }
}
