package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.springframework.stereotype.Component;

import java.util.Set;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

/**
 * Classifies a principal as a citizen or an employee.
 *
 * <p>Lifted verbatim out of the deleted {@code PrincipalScopeResolver}, whose scope-resolution job
 * moved to the ABAC engine but which was also the single source of truth for this one
 * security-relevant question. Both callers — analytics' complaint-search ownership scoping and the
 * policy scope resolver — need the same answer, and the reason it was one method in the first place
 * was to stop the two drifting.
 */
@Component
public class Principals {

    /**
     * Marker roles every HRMS-issued token carries alongside the functional role. Their presence is
     * what makes a principal an employee, regardless of what else they hold.
     */
    private static final Set<String> EMPLOYEE_ROLE_CODES = Set.of("EMPLOYEE", "COMMON_EMPLOYEE");

    private static final String CITIZEN_ROLE_CODE = "CITIZEN";

    /**
     * A "pure citizen" HOLDS the {@code CITIZEN} role and holds no employee role. Such a principal
     * is locked to their own records everywhere.
     *
     * <p>Citizen-side principals legitimately carry additional non-employee roles, so requiring
     * {@code CITIZEN} to be the SOLE role would misclassify them as employees and push them down
     * the HRMS path where they fail closed. Conversely an employee who also holds {@code CITIZEN}
     * is still an employee and is not self-scoped.
     *
     * <p>Roles decide first, but a principal carrying no employee role and no recognisable citizen
     * role falls back to the declared user type — so an abnormal role state (a role-sync gap, a
     * legacy OTP session with empty roles, a citizen role coded differently) cannot silently demote
     * a citizen out of self-scoping. That fallback is what keeps this fail-closed: without it such a
     * principal matches neither branch in {@code EnrichmentService.enrichSearchRequest}, userIds
     * stays empty, and the query builder drops the ownership clause entirely — reopening #1071.
     */
    public boolean isPureCitizen(RequestInfo requestInfo) {
        User u = requestInfo == null ? null : requestInfo.getUserInfo();
        if (u == null)
            return false;

        boolean hasCitizenRole = false;
        boolean hasEmployeeRole = false;
        if (u.getRoles() != null) {
            for (Role r : u.getRoles()) {
                if (r == null || r.getCode() == null) continue;
                String c = r.getCode().trim().toUpperCase();
                if (c.equals(CITIZEN_ROLE_CODE)) hasCitizenRole = true;
                else if (EMPLOYEE_ROLE_CODES.contains(c)) hasEmployeeRole = true;
            }
        }

        if (hasEmployeeRole) return false;
        if (hasCitizenRole) return true;
        return USERTYPE_CITIZEN.equalsIgnoreCase(u.getType());
    }
}
