package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.accesscontrol.PgrRowScope;
import org.egov.pgr.accesscontrol.ResourceDecision;
import org.egov.pgr.accesscontrol.ResourceEvaluationResponse;
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
    @Mock private SearchAccessService searchAccessService;

    private PGRService pgrService;

    @BeforeEach
    void setup() {
        when(config.getStateLevelTenantIdLength()).thenReturn(2);
        pgrService = new PGRService(enrichmentService, userService, workflowService, validator, validator, producer,
                config, repository, mdmsUtils, complaintDomainEventService, pgrUtils,
                extendedAttributesValidationService, encryptionDecryptionService, searchAccessService);
    }

    @Test
    void searchResolvesScopeAndKeepsPolicyAllowedResults() {
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").serviceRequestId("SR-1").build();
        PgrRowScope scope = new PgrRowScope("pg.city", false, List.of("citizen-1"), null, null);
        ServiceWrapper wrapper = wrapper("citizen-1", "SR-1");
        ResourceEvaluationResponse decisions = allowing("SR-1");

        when(searchAccessService.resolveScope(requestInfo, "pg.city"))
                .thenReturn(SearchAccessService.ScopeResolution.of(scope));
        when(repository.getServiceWrappers(criteria, scope)).thenReturn(new ArrayList<>(List.of(wrapper)));
        when(searchAccessService.evaluate(eq(requestInfo), eq("pg.city"), anyList())).thenReturn(decisions);
        when(searchAccessService.dropDenied(anyList(), eq(decisions))).thenReturn(List.of(wrapper));
        when(workflowService.enrichWorkflow(eq(requestInfo), anyList())).thenAnswer(inv -> inv.getArgument(1));

        List<ServiceWrapper> result = pgrService.search(requestInfo, criteria);

        assertEquals(1, result.size());
        verify(repository).getServiceWrappers(criteria, scope);
        // Masks are applied AFTER enrichment: an obligation on citizen.mobileNumber is a no-op
        // while the citizen has not been enriched onto the wrapper yet.
        verify(searchAccessService).applyMasks(anyList(), eq(decisions));
    }

    @Test
    void searchReturnsEmptyWhenPolicyEnforcementDropsEverything() {
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").serviceRequestId("SR-1").build();
        PgrRowScope scope = new PgrRowScope("pg.city", false, List.of("citizen-1"), null, null);
        ServiceWrapper wrapper = wrapper("citizen-2", "SR-2");
        ResourceEvaluationResponse decisions = allowing("SR-2");

        when(searchAccessService.resolveScope(any(), any()))
                .thenReturn(SearchAccessService.ScopeResolution.of(scope));
        when(repository.getServiceWrappers(criteria, scope)).thenReturn(new ArrayList<>(List.of(wrapper)));
        when(searchAccessService.evaluate(eq(requestInfo), eq("pg.city"), anyList())).thenReturn(decisions);
        when(searchAccessService.dropDenied(anyList(), eq(decisions))).thenReturn(new ArrayList<>());

        List<ServiceWrapper> result = pgrService.search(requestInfo, criteria);

        assertTrue(result.isEmpty());
        verify(userService, never()).enrichUsers(any(), any());
    }

    @Test
    void searchShortCircuitsToEmptyOnADenyScopeWithoutQueryingOrEvaluating() {
        // A DENY scope is an answer, not an error. Asking the database for rows every one of which
        // is already excluded is work with a known result.
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();

        when(searchAccessService.resolveScope(requestInfo, "pg.city"))
                .thenReturn(SearchAccessService.ScopeResolution.DENY_ALL);

        assertTrue(pgrService.search(requestInfo, criteria).isEmpty());

        verify(repository, never()).getServiceWrappers(any(), any());
        verify(searchAccessService, never()).evaluate(any(), any(), anyList());
    }

    @Test
    void countResolvesScopeAndPassesItToTheRepository() {
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();
        PgrRowScope scope = new PgrRowScope("pg.city", false, List.of(), List.of("SANITATION"), null);

        when(searchAccessService.resolveScope(requestInfo, "pg.city"))
                .thenReturn(SearchAccessService.ScopeResolution.of(scope));
        when(repository.getCount(criteria, scope)).thenReturn(3);

        Integer count = pgrService.count(requestInfo, criteria);

        assertEquals(3, count);
        verify(repository).getCount(criteria, scope);
    }

    @Test
    void countAndSearchShareOneScopeSoTheyCanNeverDisagree() {
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE", "pg.city");
        RequestSearchCriteria criteria = RequestSearchCriteria.builder().tenantId("pg.city").build();

        when(searchAccessService.resolveScope(requestInfo, "pg.city"))
                .thenReturn(SearchAccessService.ScopeResolution.DENY_ALL);

        assertEquals(0, pgrService.count(requestInfo, criteria));
        verify(repository, never()).getCount(any(), any());
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

    private static ResourceEvaluationResponse allowing(String... serviceRequestIds) {
        List<ResourceDecision> results = new ArrayList<>();
        for (String id : serviceRequestIds)
            results.add(ResourceDecision.builder().id(id).allowed(true).obligations(List.of()).build());
        return ResourceEvaluationResponse.builder().results(results).build();
    }

    private ServiceWrapper wrapper(String accountId, String serviceRequestId) {
        Service service = Service.builder()
                .accountId(accountId)
                .serviceRequestId(serviceRequestId)
                .tenantId("pg.city")
                .auditDetails(AuditDetails.builder().createdTime(1L).build())
                .build();
        return ServiceWrapper.builder().service(service).build();
    }
}
