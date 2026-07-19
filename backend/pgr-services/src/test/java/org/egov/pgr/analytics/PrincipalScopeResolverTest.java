package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestTemplate;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Guards the pure-citizen classification (#1071). This is the single source of truth deciding
 * whether a principal is locked to their OWN complaints, so a misclassification here is a data
 * leak, not a cosmetic bug — hence the fail-closed cases below.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class PrincipalScopeResolverTest {

    @Mock private PGRConfiguration config;
    @Mock private RestTemplate restTemplate;
    @Mock private ObjectMapper mapper;

    @InjectMocks
    private PrincipalScopeResolver resolver;

    private RequestInfo requestInfoWith(String type, String... roleCodes) {
        List<Role> roles = roleCodes == null ? null : Arrays.stream(roleCodes)
                .map(c -> Role.builder().code(c).build())
                .collect(java.util.stream.Collectors.toList());
        User user = User.builder().uuid("uuid-1").type(type).roles(roles).build();
        return RequestInfo.builder().userInfo(user).build();
    }

    @Test
    void citizenRole_isPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN")));
    }

    @Test
    void citizenWithExtraNonEmployeeRoles_isStillPureCitizen() {
        // the #1100 review point: a citizen may legitimately carry additional citizen-side roles.
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN", "PGR_CITIZEN_EXTRA")));
    }

    @Test
    void employee_isNotPureCitizen() {
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "EMPLOYEE", "GRO")));
    }

    @Test
    void employeeAlsoHoldingCitizenRole_isNotPureCitizen() {
        // employee marker wins — such a principal must keep the employee (HRMS) scope path.
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "EMPLOYEE")));
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "COMMON_EMPLOYEE")));
    }

    @Test
    void citizenTypeWithNullRoles_failsClosedToPureCitizen() {
        // fail-CLOSED: without the type fallback this returns false, enrichSearchRequest matches
        // neither branch, userIds stays empty and the ownership clause is dropped — reopening #1071.
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", (String[]) null)));
    }

    @Test
    void citizenTypeWithEmptyRoles_failsClosedToPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN")));
    }

    @Test
    void citizenTypeWithUnrecognisedRoleCode_failsClosedToPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "SOME_OTHER_CITIZEN_ROLE")));
    }

    @Test
    void systemPrincipalWithNoRoles_isNotPureCitizen() {
        // internal/system callers must NOT be self-scoped to a uuid.
        assertFalse(resolver.isPureCitizen(requestInfoWith("SYSTEM")));
    }

    @Test
    void nullRequestInfoOrUserInfo_isNotPureCitizen() {
        assertFalse(resolver.isPureCitizen(null));
        assertFalse(resolver.isPureCitizen(RequestInfo.builder().build()));
    }

    @Test
    void roleCodeIsCaseAndWhitespaceInsensitive() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", " citizen ")));
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", " employee ")));
    }

    @Test
    void nullRoleEntryIsIgnored() {
        User user = User.builder().uuid("uuid-1").type("CITIZEN")
                .roles(Arrays.asList(null, Role.builder().code("CITIZEN").build()))
                .build();
        assertTrue(resolver.isPureCitizen(RequestInfo.builder().userInfo(user).build()));
    }
}
