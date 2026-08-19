package org.egov.pgr.accesscontrol;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.service.SearchAccessService;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The PGR search PEP. Everything here is enforcement of an answer that came from somewhere else:
 * what is asserted is that a decision reaches SQL and the response intact, and that anything PGR
 * cannot enforce confidently removes data rather than returning it.
 */
@ExtendWith(MockitoExtension.class)
class SearchAccessServiceTest {

    private static final String TENANT = "pg.citya";

    @Mock
    private AccessControlDecisionClient client;

    private SearchAccessService service;

    @BeforeEach
    void setUp() {
        service = new SearchAccessService(client);
    }

    // ---- base action ------------------------------------------------------------------------

    @Test
    void bindsTheReturnedScopeForSqlToFilterBy() {
        givenDecision(allowed(filterScope(TenantMatch.EXACT, TENANT, List.of(),
                axis(AxisMode.VALUES, "DEPT_A"), axis(AxisMode.ALL))));

        SearchAccessService.ScopeResolution resolution = service.resolveScope(requestInfo(), TENANT);

        assertThat(resolution.denyAll).isFalse();
        assertThat(resolution.scope.tenantId).isEqualTo(TENANT);
        assertThat(resolution.scope.tenantSubtree).isFalse();
        assertThat(resolution.scope.departmentCodes).containsExactly("DEPT_A");
        assertThat(resolution.scope.jurisdictionCodes).isNull();
    }

    @Test
    void aDenyScopeShortCircuitsWithoutAScopeToQueryWith() {
        givenDecision(allowed(ResolvedScope.builder()
                .effect(ScopeEffect.DENY)
                .tenant(TenantScope.builder().match(TenantMatch.EXACT).value(TENANT).build())
                .citizenUuids(List.of())
                .axes(ScopeAxes.builder().department(axis(AxisMode.ALL)).jurisdiction(axis(AxisMode.ALL)).build())
                .build()));

        assertThat(service.resolveScope(requestInfo(), TENANT).denyAll).isTrue();
    }

    @Test
    void aDeniedActionIsForbiddenNotAnEmptyResult() {
        givenDecision(PolicyDecision.builder()
                .key(SearchAccessService.PGR_SEARCH_ACTION).allowed(false).reason("ACTION_NOT_MAPPED").build());

        assertThatThrownBy(() -> service.resolveScope(requestInfo(), TENANT))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void aMissingDecisionForTheBaseActionFailsClosedRatherThanRunningUnscoped() {
        when(client.resolve(any(), anyString(), anyList()))
                .thenReturn(PolicyResolveResponse.builder().decisions(List.of()).build());

        assertThatThrownBy(() -> service.resolveScope(requestInfo(), TENANT))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    @Test
    void anAllowedDecisionWithNoScopeIsUnusableAndFailsClosed() {
        // "Allowed, and here is nothing to filter by" is indistinguishable from a truncated
        // response. PGR cannot tell them apart, so it refuses rather than returning every row.
        givenDecision(allowed(null));

        assertThatThrownBy(() -> service.resolveScope(requestInfo(), TENANT))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    @Test
    void anAxisWithNoModeIsMalformedAndNeverReadAsUnrestricted() {
        givenDecision(allowed(filterScope(TenantMatch.SUBTREE, "pg", List.of(),
                AxisScope.builder().build(), axis(AxisMode.ALL))));

        assertThatThrownBy(() -> service.resolveScope(requestInfo(), TENANT))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    // ---- row evaluation ---------------------------------------------------------------------

    @Test
    void submitsEachRowUnderItsServiceRequestIdWithTheRawFactsOnly() {
        ArgumentCaptor<List<ResourceInput>> captor = captor();
        when(client.evaluateResources(any(), anyString(), any(), captor.capture()))
                .thenReturn(evaluation(decision("SR-1", true), decision("SR-2", true)));

        service.evaluate(requestInfo(), TENANT, List.of(
                wrapper("SR-1", "citizen-1", "DEPT_A", "WARD_5"),
                wrapper("SR-2", "citizen-2", "DEPT_B", "WARD_6")));

        assertThat(captor.getValue()).extracting(ResourceInput::getId).containsExactly("SR-1", "SR-2");
        ResourceAttributes first = captor.getValue().get(0).getAttributes();
        assertThat(first.getAccountId()).isEqualTo("citizen-1");
        assertThat(first.getDepartment()).isEqualTo("DEPT_A");
        assertThat(first.getBoundary()).isEqualTo("WARD_5");
    }

    @Test
    void dropsDeniedRowsAndRowsNoDecisionCameBackFor() {
        ServiceWrapper allowed = wrapper("SR-1", "citizen-1", "DEPT_A", "WARD_5");
        ServiceWrapper denied = wrapper("SR-2", "citizen-2", "DEPT_B", "WARD_6");
        ServiceWrapper unanswered = wrapper("SR-3", "citizen-3", "DEPT_C", "WARD_7");

        List<ServiceWrapper> kept = service.dropDenied(List.of(allowed, denied, unanswered),
                evaluation(decision("SR-1", true), decision("SR-2", false)));

        assertThat(kept).containsExactly(allowed);
    }

    @Test
    void twoRowsUnderOneServiceRequestIdFailTheWholePageClosed() {
        // Correlation is the only thing tying a decision to a row. If two rows share an id, one
        // row's allow could be applied to the other, so the page is refused rather than guessed at.
        assertThatThrownBy(() -> service.evaluate(requestInfo(), TENANT, List.of(
                wrapper("SR-1", "citizen-1", "DEPT_A", "WARD_5"),
                wrapper("SR-1", "citizen-2", "DEPT_B", "WARD_6"))))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    @Test
    void aRowWithNoServiceRequestIdCannotBeCorrelatedAndFailsClosed() {
        assertThatThrownBy(() -> service.evaluate(requestInfo(), TENANT,
                List.of(wrapper(null, "citizen-1", "DEPT_A", "WARD_5"))))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    // ---- obligations ------------------------------------------------------------------------

    @Test
    void appliesAReturnedRedactionToTheEnrichedField() {
        ServiceWrapper wrapper = wrapper("SR-1", "citizen-1", "DEPT_A", "WARD_5");
        wrapper.getService().setCitizen(User.builder().mobileNumber("9999999999").build());

        service.applyMasks(List.of(wrapper), evaluation(ResourceDecision.builder()
                .id("SR-1").allowed(true)
                .obligations(List.of(FieldObligation.builder()
                        .path("citizen.mobileNumber").type(ObligationType.REDACT).build()))
                .build()));

        assertThat(wrapper.getService().getCitizen().getMobileNumber()).isNull();
    }

    @Test
    void anObligationWithNoPathIsNeverSilentlySkipped() {
        // Skipping it would leave the very field the obligation exists to hide in the response.
        ServiceWrapper wrapper = wrapper("SR-1", "citizen-1", "DEPT_A", "WARD_5");
        wrapper.getService().setCitizen(User.builder().mobileNumber("9999999999").build());

        assertThatThrownBy(() -> service.applyMasks(List.of(wrapper), evaluation(ResourceDecision.builder()
                .id("SR-1").allowed(true)
                .obligations(List.of(FieldObligation.builder().type(ObligationType.REDACT).build()))
                .build())))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    @Test
    void searchAndCountAskAboutTheSameActionSoTheyCanNeverDisagree() {
        ArgumentCaptor<List<ActionQuery>> captor = captor();
        when(client.resolve(any(), anyString(), captor.capture()))
                .thenReturn(PolicyResolveResponse.builder()
                        .decisions(List.of(allowed(filterScope(TenantMatch.EXACT, TENANT, List.of(),
                                axis(AxisMode.ALL), axis(AxisMode.ALL)))))
                        .build());

        service.resolveScope(requestInfo(), TENANT);
        service.resolveScope(requestInfo(), TENANT);

        assertThat(captor.getAllValues()).allSatisfy(actions ->
                assertThat(actions).singleElement()
                        .satisfies(a -> assertThat(a.getUrl()).isEqualTo(SearchAccessService.PGR_SEARCH_ACTION)));
        verify(client, org.mockito.Mockito.times(2)).resolve(any(), anyString(), anyList());
    }

    // ---- helpers ----------------------------------------------------------------------------

    private void givenDecision(PolicyDecision decision) {
        when(client.resolve(any(), anyString(), anyList()))
                .thenReturn(PolicyResolveResponse.builder().decisions(List.of(decision)).build());
    }

    private static PolicyDecision allowed(ResolvedScope scope) {
        return PolicyDecision.builder()
                .key(SearchAccessService.PGR_SEARCH_ACTION).allowed(true).scope(scope).build();
    }

    private static ResolvedScope filterScope(TenantMatch match, String tenant, List<String> citizenUuids,
                                             AxisScope department, AxisScope jurisdiction) {
        return ResolvedScope.builder()
                .effect(ScopeEffect.FILTER)
                .tenant(TenantScope.builder().match(match).value(tenant).build())
                .citizenUuids(citizenUuids)
                .axes(ScopeAxes.builder().department(department).jurisdiction(jurisdiction).build())
                .build();
    }

    private static AxisScope axis(AxisMode mode, String... values) {
        return AxisScope.builder().mode(mode).values(List.of(values)).build();
    }

    private static ResourceEvaluationResponse evaluation(ResourceDecision... results) {
        return ResourceEvaluationResponse.builder()
                .decision(PolicyDecision.builder()
                        .key(SearchAccessService.PGR_SEARCH_ACTION).allowed(true).build())
                .results(List.of(results))
                .build();
    }

    private static ResourceDecision decision(String id, boolean allowed) {
        return ResourceDecision.builder().id(id).allowed(allowed).obligations(List.of()).build();
    }

    private static ServiceWrapper wrapper(String serviceRequestId, String accountId, String department,
                                          String locality) {
        Service service = Service.builder()
                .serviceRequestId(serviceRequestId)
                .accountId(accountId)
                .tenantId(TENANT)
                .additionalDetail(java.util.Map.of("department", department))
                .address(Address.builder().locality(Boundary.builder().code(locality).build()).build())
                .build();
        return ServiceWrapper.builder().service(service).build();
    }

    private static RequestInfo requestInfo() {
        return RequestInfo.builder().authToken("token").build();
    }

    @SuppressWarnings("unchecked")
    private static <T> ArgumentCaptor<List<T>> captor() {
        return (ArgumentCaptor<List<T>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(List.class);
    }
}
