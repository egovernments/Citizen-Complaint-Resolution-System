package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Citizen classification, ported unchanged from the retired {@code PrincipalScopeResolverTest} when
 * the method moved to {@link Principals}. The scope resolution around it went to the ABAC engine;
 * this question did not change, and neither should its answers.
 */
public class PrincipalsTest {

    private final Principals principals = new Principals();

    private RequestInfo requestInfoWith(String type, String... roleCodes) {
        List<Role> roles = roleCodes == null ? null : Arrays.stream(roleCodes)
                .map(c -> Role.builder().code(c).build())
                .collect(java.util.stream.Collectors.toList());
        User user = User.builder().uuid("uuid-1").type(type).roles(roles).build();
        return RequestInfo.builder().userInfo(user).build();
    }

    @Test
    void citizenRole_isPureCitizen() {
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN")));
    }

    @Test
    void citizenWithExtraNonEmployeeRoles_isStillPureCitizen() {
        // the #1100 review point: a citizen may legitimately carry additional citizen-side roles.
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN", "PGR_CITIZEN_EXTRA")));
    }

    @Test
    void employee_isNotPureCitizen() {
        assertFalse(principals.isPureCitizen(requestInfoWith("EMPLOYEE", "EMPLOYEE", "GRO")));
    }

    @Test
    void employeeAlsoHoldingCitizenRole_isNotPureCitizen() {
        // employee marker wins — such a principal must keep the employee (HRMS) scope path.
        assertFalse(principals.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "EMPLOYEE")));
        assertFalse(principals.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "COMMON_EMPLOYEE")));
    }

    @Test
    void citizenTypeWithNullRoles_failsClosedToPureCitizen() {
        // fail-CLOSED: without the type fallback this returns false, enrichSearchRequest matches
        // neither branch, userIds stays empty and the ownership clause is dropped — reopening #1071.
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN", (String[]) null)));
    }

    @Test
    void citizenTypeWithEmptyRoles_failsClosedToPureCitizen() {
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN")));
    }

    @Test
    void citizenTypeWithUnrecognisedRoleCode_failsClosedToPureCitizen() {
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN", "SOME_OTHER_CITIZEN_ROLE")));
    }

    @Test
    void systemPrincipalWithNoRoles_isNotPureCitizen() {
        // internal/system callers must NOT be self-scoped to a uuid.
        assertFalse(principals.isPureCitizen(requestInfoWith("SYSTEM")));
    }

    @Test
    void nullRequestInfoOrUserInfo_isNotPureCitizen() {
        assertFalse(principals.isPureCitizen(null));
        assertFalse(principals.isPureCitizen(RequestInfo.builder().build()));
    }

    @Test
    void roleCodeIsCaseAndWhitespaceInsensitive() {
        assertTrue(principals.isPureCitizen(requestInfoWith("CITIZEN", " citizen ")));
        assertFalse(principals.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", " employee ")));
    }

    @Test
    void nullRoleEntryIsIgnored() {
        User user = User.builder().uuid("uuid-1").type("CITIZEN")
                .roles(Arrays.asList(null, Role.builder().code("CITIZEN").build()))
                .build();
        assertTrue(principals.isPureCitizen(RequestInfo.builder().userInfo(user).build()));
    }
}
