package org.egov.pgr.analytics;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.accesscontrol.AccessControlDecisionClient;
import org.egov.pgr.accesscontrol.AccessControlUnavailableException;
import org.egov.pgr.accesscontrol.ActionQuery;
import org.egov.pgr.accesscontrol.AxisMode;
import org.egov.pgr.accesscontrol.AxisScope;
import org.egov.pgr.accesscontrol.PolicyDecision;
import org.egov.pgr.accesscontrol.PolicyResolveResponse;
import org.egov.pgr.accesscontrol.ResolvedScope;
import org.egov.pgr.accesscontrol.ScopeAxes;
import org.egov.pgr.accesscontrol.ScopeEffect;
import org.egov.pgr.accesscontrol.TenantMatch;
import org.egov.pgr.accesscontrol.TenantScope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The analytics PEP's side of the conversation: one resolve call per request, capabilities taken
 * only from decisions that actually said yes, and a row scope that is either usable or refused.
 */
@ExtendWith(MockitoExtension.class)
class AnalyticsAccessServiceTest {

    private static final String TENANT = "ke.bomet";

    @Mock
    private AccessControlDecisionClient client;

    private AnalyticsAccessService service;

    @BeforeEach
    void setUp() {
        service = new AnalyticsAccessService(client);
    }

    @Test
    void asksAboutEveryAnalyticsActionInOneCall() {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ActionQuery>> captor =
                (ArgumentCaptor<List<ActionQuery>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(List.class);
        when(client.resolve(any(), anyString(), captor.capture())).thenReturn(response(allowed(AnalyticsAccess.QUERY)));

        service.resolve(requestInfo(), TENANT);

        verify(client, times(1)).resolve(any(), anyString(), any());
        assertThat(captor.getValue()).extracting(ActionQuery::getUrl)
                .containsExactlyElementsOf(AnalyticsAccess.ALL_ACTIONS);
        // Only the base query action asks for a complaint scope; the rest have nowhere to apply one.
        assertThat(captor.getValue()).filteredOn(a -> a.getResourceType() != null)
                .singleElement().satisfies(a -> assertThat(a.getUrl()).isEqualTo(AnalyticsAccess.QUERY));
    }

    @Test
    void grantsOnlyTheActionsTheDecisionPointAllowed() {
        when(client.resolve(any(), anyString(), any())).thenReturn(response(
                allowed(AnalyticsAccess.QUERY),
                allowed(AnalyticsAccess.PACKS),
                denied(AnalyticsAccess.CAPABILITY_OFFICER)));

        AnalyticsAccess access = service.resolve(requestInfo(), TENANT);

        assertThat(access.allows(AnalyticsAccess.PACKS)).isTrue();
        assertThat(access.allowsOfficerPii()).isFalse();
        // Never asked about, never answered — and therefore not granted.
        assertThat(access.allows(AnalyticsAccess.CONFIG_REFRESH)).isFalse();
        assertThat(access.isPublicSurface()).isFalse();
    }

    @Test
    void aDecisionThatNeverCameBackIsNotAGrant() {
        when(client.resolve(any(), anyString(), any()))
                .thenReturn(PolicyResolveResponse.builder().decisions(List.of()).build());

        AnalyticsAccess access = service.resolve(requestInfo(), TENANT);

        assertThat(access.getCapabilities()).isEmpty();
        assertThat(access.isDenyAllRows()).isTrue();
        assertThat(access.getRowScope()).isNull();
    }

    @Test
    void bindsTheReturnedScopeWhenTheBaseQueryIsGranted() {
        when(client.resolve(any(), anyString(), any())).thenReturn(response(PolicyDecision.builder()
                .key(AnalyticsAccess.QUERY).allowed(true)
                .scope(ResolvedScope.builder()
                        .effect(ScopeEffect.FILTER)
                        .tenant(TenantScope.builder().match(TenantMatch.SUBTREE).value("ke").build())
                        .citizenUuids(List.of())
                        .axes(ScopeAxes.builder()
                                .department(AxisScope.builder().mode(AxisMode.VALUES).values(List.of("DEPT_A")).build())
                                .jurisdiction(AxisScope.builder().mode(AxisMode.VALUES).values(List.of("WARD_5")).build())
                                .build())
                        .build())
                .build()));

        AnalyticsAccess access = service.resolve(requestInfo(), TENANT);

        assertThat(access.isDenyAllRows()).isFalse();
        assertThat(access.getRowScope().tenantSubtree).isTrue();
        assertThat(access.getRowScope().departmentCodes).containsExactly("DEPT_A");
        assertThat(access.getRowScope().jurisdictionCodes).containsExactly("WARD_5");
    }

    @Test
    void aDenyScopeMeansAllowedButNoRows() {
        when(client.resolve(any(), anyString(), any())).thenReturn(response(PolicyDecision.builder()
                .key(AnalyticsAccess.QUERY).allowed(true)
                .scope(ResolvedScope.builder()
                        .effect(ScopeEffect.DENY)
                        .tenant(TenantScope.builder().match(TenantMatch.EXACT).value(TENANT).build())
                        .citizenUuids(List.of())
                        .build())
                .build()));

        AnalyticsAccess access = service.resolve(requestInfo(), TENANT);

        assertThat(access.allows(AnalyticsAccess.QUERY)).isTrue();
        assertThat(access.isDenyAllRows()).isTrue();
    }

    @Test
    void anAllowedQueryWithNoUsableScopeFailsClosed() {
        when(client.resolve(any(), anyString(), any())).thenReturn(response(PolicyDecision.builder()
                .key(AnalyticsAccess.QUERY).allowed(true).build()));

        assertThatThrownBy(() -> service.resolve(requestInfo(), TENANT))
                .isInstanceOf(AccessControlUnavailableException.class);
    }

    private static PolicyResolveResponse response(PolicyDecision... decisions) {
        return PolicyResolveResponse.builder().decisions(new ArrayList<>(List.of(decisions))).build();
    }

    private static PolicyDecision allowed(String url) {
        PolicyDecision.PolicyDecisionBuilder builder = PolicyDecision.builder().key(url).allowed(true);
        if (AnalyticsAccess.QUERY.equals(url))
            builder.scope(ResolvedScope.builder()
                    .effect(ScopeEffect.FILTER)
                    .tenant(TenantScope.builder().match(TenantMatch.EXACT).value(TENANT).build())
                    .citizenUuids(List.of())
                    .axes(ScopeAxes.builder()
                            .department(AxisScope.builder().mode(AxisMode.ALL).build())
                            .jurisdiction(AxisScope.builder().mode(AxisMode.ALL).build())
                            .build())
                    .build());
        return builder.build();
    }

    private static PolicyDecision denied(String url) {
        return PolicyDecision.builder().key(url).allowed(false).reason("ACTION_NOT_MAPPED").build();
    }

    private static RequestInfo requestInfo() {
        return RequestInfo.builder().authToken("token").build();
    }
}
