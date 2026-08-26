package org.egov.pgr.service;

import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.BoundaryUtil;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.EmployeeJurisdiction;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Pins the observable behavior a caller (PGRService) relies on: an unscoped role is a pure
 * no-op; a scoped role with no resolvable jurisdiction is denied; and — the point of this
 * feature — an employee holding MULTIPLE jurisdiction rows, at the SAME or DIFFERENT boundary
 * levels, ends up scoped to the UNION of each row's expanded descendant subtree, not just the
 * first row or the raw unexpanded codes.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EmployeeJurisdictionScopeServiceTest {

    private static final String TENANT = "mz.maputo";

    @Mock private HRMSUtil hrmsUtil;
    @Mock private BoundaryUtil boundaryUtil;
    @Mock private PGRConfiguration config;

    private EmployeeJurisdictionScopeService service;

    @BeforeEach
    void setUp() {
        service = new EmployeeJurisdictionScopeService(hrmsUtil, boundaryUtil, config);
        when(config.getJurisdictionScopeRoles()).thenReturn(List.of("CMS_SUPERVISOR"));
    }

    private RequestInfo requestInfoFor(String... roleCodes) {
        User user = new User();
        user.setUuid("emp-uuid");
        List<Role> roles = new java.util.ArrayList<>();
        for (String code : roleCodes) {
            Role role = new Role();
            role.setCode(code);
            roles.add(role);
        }
        user.setRoles(roles);
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    @Test
    void callerWithoutScopedRole_isUnrestricted() {
        RequestInfo requestInfo = requestInfoFor("SOME_OTHER_ROLE");
        RequestSearchCriteria criteria = new RequestSearchCriteria();

        boolean canProceed = service.applyScope(requestInfo, TENANT, criteria);

        assertTrue(canProceed);
        assertNull(criteria.getJurisdictionBoundaryCodes());
    }

    @Test
    void scopedRole_withNoHrmsJurisdiction_isDenied() {
        RequestInfo requestInfo = requestInfoFor("CMS_SUPERVISOR");
        when(hrmsUtil.getCurrentJurisdictions(eq("emp-uuid"), any(), eq(TENANT)))
                .thenReturn(Collections.emptyList());
        RequestSearchCriteria criteria = new RequestSearchCriteria();

        boolean canProceed = service.applyScope(requestInfo, TENANT, criteria);

        assertFalse(canProceed);
    }

    @Test
    void multipleJurisdictionRows_seeUnionOfEachRowsExpandedSubtree() {
        RequestInfo requestInfo = requestInfoFor("CMS_SUPERVISOR");
        when(hrmsUtil.getCurrentJurisdictions(eq("emp-uuid"), any(), eq(TENANT))).thenReturn(List.of(
                new EmployeeJurisdiction("MAPUTO_ADMIN", "KAMPFUMO"), // a district, above leaf level
                new EmployeeJurisdiction("MAPUTO_ADMIN", "WARD5")     // an unrelated leaf ward elsewhere
        ));
        // KAMPFUMO expands to itself + the wards under it.
        when(boundaryUtil.expandToDescendants(TENANT, "MAPUTO_ADMIN", "KAMPFUMO", requestInfo))
                .thenReturn(Set.of("KAMPFUMO", "WARD1", "WARD2"));
        // WARD5 is already a leaf — expands to just itself.
        when(boundaryUtil.expandToDescendants(TENANT, "MAPUTO_ADMIN", "WARD5", requestInfo))
                .thenReturn(Set.of("WARD5"));

        RequestSearchCriteria criteria = new RequestSearchCriteria();
        boolean canProceed = service.applyScope(requestInfo, TENANT, criteria);

        assertTrue(canProceed);
        assertEquals(Set.of("KAMPFUMO", "WARD1", "WARD2", "WARD5"), criteria.getJurisdictionBoundaryCodes());
    }

    @Test
    void hrmsCallFailure_isFailClosed_regardlessOfBoundaryUtil() {
        RequestInfo requestInfo = requestInfoFor("CMS_SUPERVISOR");
        when(hrmsUtil.getCurrentJurisdictions(anyString(), any(), anyString()))
                .thenThrow(new RuntimeException("HRMS down"));
        RequestSearchCriteria criteria = new RequestSearchCriteria();

        boolean canProceed = service.applyScope(requestInfo, TENANT, criteria);

        assertFalse(canProceed);
    }
}
