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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
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
        when(workflowService.getServiceRequestIdsByAssignee(any(), any(), any())).thenReturn(java.util.Set.of("PGR-1"));

        pgrService.count(employee("lme-1"), criteria());

        assertSame(denied, countScope());
        verify(workflowService, never()).getServiceRequestIdsByAssignee(any(), any(), any());
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
