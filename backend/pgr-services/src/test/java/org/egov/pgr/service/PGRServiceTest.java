package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.FieldVisibilityService;
import org.egov.pgr.policy.SearchAccessPolicyService;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies PGRService.search()/count() resolve an RBAC scope via SearchAccessPolicyService,
 * thread it into the repository call, and re-check the fetched page through policy enforcement —
 * the end-to-end wiring for the access-control policy reference rule.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PGRServiceTest {

    @Mock private EnrichmentService enrichmentService;
    @Mock private UserService userService;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestValidator validator;
    @Mock private Producer producer;
    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private ComplaintDomainEventService complaintDomainEventService;
    @Mock private PGRUtils pgrUtils;
    @Mock private ExtendedAttributesValidationService extendedAttributesValidationService;
    @Mock private EncryptionDecryptionService encryptionDecryptionService;
    @Mock private SearchAccessPolicyService searchAccessPolicyService;
    @Mock private FieldVisibilityService fieldVisibilityService;

    private PGRService pgrService;

    @BeforeEach
    void setup() {
        when(config.getStateLevelTenantIdLength()).thenReturn(2);
        pgrService = new PGRService(enrichmentService, userService, workflowService, validator, validator, producer,
                config, repository, mdmsUtils, complaintDomainEventService, pgrUtils,
                extendedAttributesValidationService, encryptionDecryptionService, searchAccessPolicyService,
                fieldVisibilityService);
    }

    @Test
    void searchResolvesScopeAndKeepsPolicyAllowedResults() {
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").serviceRequestId("SR-1").build();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, "citizen-1", null, null);
        ServiceWrapper wrapper = wrapper("citizen-1");

        when(searchAccessPolicyService.resolveScope(eq(requestInfo), eq("pg.city"), anyInt())).thenReturn(scope);
        when(repository.getServiceWrappers(criteria, scope)).thenReturn(new ArrayList<>(List.of(wrapper)));
        when(searchAccessPolicyService.enforce(eq(requestInfo), eq("pg.city"), eq(scope), anyList())).thenReturn(List.of(wrapper));
        when(workflowService.enrichWorkflow(eq(requestInfo), anyList())).thenAnswer(inv -> inv.getArgument(1));

        List<ServiceWrapper> result = pgrService.search(requestInfo, criteria);

        assertEquals(1, result.size());
        verify(repository).getServiceWrappers(criteria, scope);
        verify(searchAccessPolicyService).enforce(requestInfo, "pg.city", scope, List.of(wrapper));
    }

    @Test
    void searchReturnsEmptyWhenPolicyEnforcementDropsEverything() {
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").serviceRequestId("SR-1").build();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, "citizen-1", null, null);
        ServiceWrapper wrapper = wrapper("citizen-2");

        when(searchAccessPolicyService.resolveScope(any(), any(), anyInt())).thenReturn(scope);
        when(repository.getServiceWrappers(criteria, scope)).thenReturn(new ArrayList<>(List.of(wrapper)));
        when(searchAccessPolicyService.enforce(eq(requestInfo), eq("pg.city"), eq(scope), anyList())).thenReturn(new ArrayList<>());

        List<ServiceWrapper> result = pgrService.search(requestInfo, criteria);

        assertTrue(result.isEmpty());
        verify(userService, never()).enrichUsers(any(), any());
    }

    @Test
    void countResolvesScopeAndPassesItToTheRepository() {
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        AnalyticsScope scope = new AnalyticsScope("pg.city", false, null, null, List.of("SANITATION"));

        when(searchAccessPolicyService.resolveScope(eq(requestInfo), eq("pg.city"), anyInt())).thenReturn(scope);
        when(repository.getCount(criteria, scope)).thenReturn(3);

        Integer count = pgrService.count(requestInfo, criteria);

        assertEquals(3, count);
        verify(repository).getCount(criteria, scope);
    }

    private RequestInfo requestInfo(String uuid, String type, String tenantId) {
        User user = new User();
        user.setUuid(uuid);
        user.setType(type);
        user.setTenantId(tenantId);
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    private ServiceWrapper wrapper(String accountId) {
        Service service = Service.builder()
                .accountId(accountId)
                .tenantId("pg.city")
                .auditDetails(AuditDetails.builder().createdTime(1L).build())
                .build();
        return ServiceWrapper.builder().service(service).build();
    }
}
