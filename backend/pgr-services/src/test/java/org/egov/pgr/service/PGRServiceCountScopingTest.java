package org.egov.pgr.service;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * CCRS #1071 — /_count must apply the same guards as /_search. The tenant and ownership predicates
 * in PGRQueryBuilder are conditional, so criteria that survive unfiltered do not narrow the count,
 * they remove the filter. Each test here fails against a count() that skips validateSearch, the
 * isEmpty() short-circuit, or the unresolved-mobileNumber short-circuit.
 *
 * <p>PGRService is constructed explicitly rather than via {@code @InjectMocks}: its constructor
 * takes two ServiceRequestValidator params, which makes by-type mock resolution ambiguous.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class PGRServiceCountScopingTest {

    @Mock private EnrichmentService enrichmentService;
    @Mock private UserService userService;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestValidator serviceRequestValidator;
    @Mock private ServiceRequestValidator validator;
    @Mock private Producer producer;
    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private ComplaintDomainEventService complaintDomainEventService;
    @Mock private PGRUtils pgrUtils;
    @Mock private ExtendedAttributesValidationService extendedAttributesValidationService;
    @Mock private EncryptionDecryptionService encryptionDecryptionService;

    private PGRService pgrService;

    @BeforeEach
    void setup() {
        pgrService = new PGRService(enrichmentService, userService, workflowService,
                serviceRequestValidator, validator, producer, config, repository, mdmsUtils,
                complaintDomainEventService, pgrUtils, extendedAttributesValidationService,
                encryptionDecryptionService);
    }

    private RequestInfo requestInfo() {
        return RequestInfo.builder().build();
    }

    @Test
    void count_rejectedByValidator_propagatesAndNeverQueries() {
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        doThrow(new CustomException("INVALID_SEARCH", "Search without params is not allowed"))
                .when(validator).validateSearch(any(), any());

        assertThrows(CustomException.class, () -> pgrService.count(requestInfo(), criteria));
        verify(repository, never()).getCount(any());
    }

    @Test
    void count_emptyCriteria_returnsZeroInsteadOfCrossTenantTotal() {
        RequestSearchCriteria criteria = new RequestSearchCriteria();

        assertEquals(0, pgrService.count(requestInfo(), criteria));
        verify(repository, never()).getCount(any());
    }

    @Test
    void count_mobileNumberResolvingToNoUser_returnsZeroInsteadOfTenantTotal() {
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        criteria.setTenantId("mz.maputo");
        criteria.setMobileNumber("9999999999");
        // scopeSearchCriteria leaves userIds empty when the number matches no user.

        assertEquals(0, pgrService.count(requestInfo(), criteria));
        verify(repository, never()).getCount(any());
    }

    @Test
    void count_mobileNumberResolvingToUser_counts() {
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        criteria.setTenantId("mz.maputo");
        criteria.setMobileNumber("9999999999");
        // Mirror the enrichment populating userIds for a resolvable number.
        doAnswer(inv -> {
            criteria.setUserIds(Collections.singleton("victim-uuid"));
            return null;
        }).when(enrichmentService).scopeSearchCriteria(any(), any());
        when(repository.getCount(any())).thenReturn(1);

        assertEquals(1, pgrService.count(requestInfo(), criteria));
    }

    @Test
    void count_scopedNonEmptyCriteria_validatesScopesAndCounts() {
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        criteria.setTenantId("mz.maputo");
        when(repository.getCount(any())).thenReturn(50);

        assertEquals(50, pgrService.count(requestInfo(), criteria));
        verify(validator).validateSearch(any(), any());
        verify(enrichmentService).scopeSearchCriteria(any(), any());
    }
}
