package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.FieldVisibilityService;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.policy.SearchAccessPolicyService;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * #2281: PGRService adds the caller's own-assigned complaints to a department/jurisdiction-restricted
 * employee scope (PGRService#withOwnAssigned). These pin who gets the exception, that it reaches the
 * repository, and that a workflow failure keeps the scope as it was.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PGRServiceOwnAssignedTest {

    private static final String TENANT = "pg.city";

    @Mock private EnrichmentService enrichmentService;
    @Mock private UserService userService;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestValidator validator;
    @Mock private Producer producer;
    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private PGRUtils pgrUtils;
    @Mock private ExtendedAttributesValidationService extendedAttributesValidationService;
    @Mock private EncryptionDecryptionService encryptionDecryptionService;
    @Mock private SearchAccessPolicyService searchAccessPolicyService;
    @Mock private FieldVisibilityService fieldVisibilityService;
    @Mock private EscalationService escalationService;
    @Mock private EscalationLockManager escalationLockManager;

    private PGRService pgrService;

    @BeforeEach
    void setup() {
        when(config.getStateLevelTenantIdLength()).thenReturn(2);
        pgrService = new PGRService(enrichmentService, userService, workflowService, validator, producer,
                config, repository, mdmsUtils, pgrUtils,
                extendedAttributesValidationService, encryptionDecryptionService, searchAccessPolicyService,
                fieldVisibilityService, escalationService, escalationLockManager);
    }

    @Test
    void denyAllScopeNeverGetsTheOwnAssignedException() {
        // #2281 review: strict mode with no policy, or a tenant outside the caller's subtree.
        PgrSearchScope denied = PgrSearchScope.deniedAll(TENANT, false);
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(denied);
        when(workflowService.getServiceRequestIdsByAssignee(any(), any(), any())).thenReturn(Set.of("PGR-1"));

        pgrService.count(employee("lme-1"), criteria());

        assertSame(denied, countScope());
        verify(workflowService, never()).getServiceRequestIdsByAssignee(any(), any(), any());
    }

    @Test
    void restrictedEmployeeScopeAdmitsTheirAssignedComplaintsInSqlAndTier2() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), eq(TENANT), eq("lme-1"))).thenReturn(Set.of("PGR-B"));
        RequestSearchCriteria criteria = criteria();
        when(repository.getServiceWrappers(eq(criteria), any())).thenReturn(new ArrayList<>(List.of(new ServiceWrapper())));

        pgrService.search(employee("lme-1"), criteria);

        ArgumentCaptor<PgrSearchScope> sqlScope = ArgumentCaptor.forClass(PgrSearchScope.class);
        verify(repository).getServiceWrappers(eq(criteria), sqlScope.capture());
        assertTrue(sqlScope.getValue().isOwnAssigned("PGR-B"));
        assertEquals(List.of("WATER"), sqlScope.getValue().departmentCodes);
        assertEquals(List.of("WT_WARD_A"), sqlScope.getValue().jurisdictionCodes);
        verify(searchAccessPolicyService).enforce(any(), eq(TENANT), same(sqlScope.getValue()), any());
    }

    @Test
    void countAppliesTheSameException() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), eq(TENANT), eq("lme-1"))).thenReturn(Set.of("PGR-B"));

        pgrService.count(employee("lme-1"), criteria());

        assertTrue(countScope().isOwnAssigned("PGR-B"));
    }

    @Test
    void citizenScopeNeverGetsTheException() {
        // Even an EMPLOYEE-typed caller pinned to citizen-self (and some department) is not widened.
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, "lme-1", List.of("WATER"), null);
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), any(), any())).thenReturn(Set.of("PGR-B"));

        pgrService.count(employee("lme-1"), criteria());

        assertSame(resolved, countScope());
        verify(workflowService, never()).getServiceRequestIdsByAssignee(any(), any(), any());
    }

    @Test
    void nonEmployeeCallerNeverGetsTheException() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), any(), any())).thenReturn(Set.of("PGR-B"));

        pgrService.count(requestInfo("sys-1", "SYSTEM"), criteria());

        assertSame(resolved, countScope());
        verify(workflowService, never()).getServiceRequestIdsByAssignee(any(), any(), any());
    }

    @Test
    void unrestrictedEmployeeScopeIsLeftAlone() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, null, null);
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);

        pgrService.count(employee("gro-1"), criteria());

        assertSame(resolved, countScope());
        verify(workflowService, never()).getServiceRequestIdsByAssignee(any(), any(), any());
    }

    @Test
    void workflowFailureKeepsTheScopeAsItWas() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), any(), any()))
                .thenThrow(new CustomException("WORKFLOW_SEARCH_FAILED", "down"));

        assertDoesNotThrow(() -> pgrService.count(employee("lme-1"), criteria()));
        assertSame(resolved, countScope());
    }

    @Test
    void myTabReusesTheOwnAssignedLookupInsteadOfAskingWorkflowTwice() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), eq(TENANT), eq("lme-1"))).thenReturn(Set.of("PGR-B"));
        RequestSearchCriteria criteria = criteria();
        criteria.setAssignee("lme-1");

        pgrService.count(employee("lme-1"), criteria);

        verify(workflowService, times(1)).getServiceRequestIdsByAssignee(any(), any(), any());
        assertEquals(Set.of("PGR-B"), criteria.getServiceRequestIds());
    }

    @Test
    void assigneeFilterForSomeoneElseStillAsksWorkflowForThem() {
        PgrSearchScope resolved = new PgrSearchScope(TENANT, false, null, List.of("WATER"), List.of("WT_WARD_A"));
        when(searchAccessPolicyService.resolveScope(any(), eq(TENANT), anyInt())).thenReturn(resolved);
        when(workflowService.getServiceRequestIdsByAssignee(any(), eq(TENANT), eq("gro-1"))).thenReturn(Set.of("PGR-A"));
        when(workflowService.getServiceRequestIdsByAssignee(any(), eq(TENANT), eq("lme-2"))).thenReturn(Set.of("PGR-C"));
        RequestSearchCriteria criteria = criteria();
        criteria.setAssignee("lme-2");

        pgrService.count(employee("gro-1"), criteria);

        assertEquals(Set.of("PGR-C"), criteria.getServiceRequestIds());
    }

    static RequestSearchCriteria criteria() {
        return RequestSearchCriteria.builder().tenantId(TENANT).build();
    }

    static RequestInfo employee(String uuid) {
        return requestInfo(uuid, "EMPLOYEE");
    }

    static RequestInfo requestInfo(String uuid, String type) {
        User user = new User();
        user.setUuid(uuid);
        user.setType(type);
        user.setTenantId(TENANT);
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    PgrSearchScope countScope() {
        ArgumentCaptor<PgrSearchScope> captor = ArgumentCaptor.forClass(PgrSearchScope.class);
        verify(repository).getCount(any(), captor.capture());
        return captor.getValue();
    }
}
