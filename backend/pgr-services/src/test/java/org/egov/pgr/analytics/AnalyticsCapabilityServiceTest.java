package org.egov.pgr.analytics;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.policy.AccessControlUnavailableException;
import org.egov.pgr.policy.AccessPolicyRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The dashboard's capability layer. It adds no grant model of its own: a capability is an action
 * the ACCESSCONTROL-ROLEACTIONS master maps to one of the caller's roles, which is exactly what
 * {@link AccessPolicyRegistry#isActionVisible} answers.
 */
@ExtendWith(MockitoExtension.class)
class AnalyticsCapabilityServiceTest {

    private static final String TENANT = "ke.bomet";

    @Mock
    private AccessPolicyRegistry registry;

    private AnalyticsCapabilityService service;

    @BeforeEach
    void setUp() {
        service = new AnalyticsCapabilityService(registry);
    }

    @Test
    void grantsOnlyTheActionsAccessControlSaysTheCallerReaches() {
        // Accesscontrol answers with every url the caller's roles reach, including plenty that have
        // nothing to do with analytics; only the analytics ones become capabilities.
        when(registry.visibleActionUrls(any(), eq(TENANT))).thenReturn(java.util.Set.of(
                AnalyticsCapabilities.ACCESS, AnalyticsCapabilities.QUERY,
                "/pgr-services/v2/request/_search"));

        AnalyticsCapabilities capabilities = service.resolve(requestInfo(), TENANT);

        assertEquals(java.util.Set.of(AnalyticsCapabilities.ACCESS, AnalyticsCapabilities.QUERY),
                capabilities.granted());
        assertFalse(capabilities.allowsOfficerPii());
        assertFalse(capabilities.isPublicSurface());
    }

    @Test
    void anUnreachableAccessControlFailsClosedRatherThanResolvingToNoCapabilities() {
        // "Denied" and "we could not ask" look identical from a capability set, and one of them is
        // an incident. Letting the outage collapse into an empty grant would render an empty
        // dashboard that looks like a permissions problem.
        when(registry.visibleActionUrls(any(), anyString()))
                .thenThrow(new AccessControlUnavailableException("accesscontrol down"));

        assertThrows(AccessControlUnavailableException.class, () -> service.resolve(requestInfo(), TENANT));
    }

    @Test
    void requireTurnsAMissingCapabilityIntoADenial() {
        AnalyticsCapabilities capabilities = AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.QUERY);

        capabilities.require(AnalyticsCapabilities.QUERY);
        AnalyticsAccessDeniedException denied = assertThrows(AnalyticsAccessDeniedException.class,
                () -> capabilities.require(AnalyticsCapabilities.CONFIG_REFRESH));

        assertEquals(AnalyticsCapabilities.CONFIG_REFRESH, denied.getAction());
    }

    @Test
    void aTileWithNoGateIsInvisibleRatherThanVisibleToEveryone() {
        // The catalog is operator-authored. A tile whose gate was forgotten or misspelled must not
        // become the one tile nothing protects.
        KpiDefinition ungated = new KpiDefinition();
        ungated.setId("cl_forgotten");

        assertFalse(AnalyticsCapabilityFixtures.full().canSee(ungated));
        assertFalse(AnalyticsCapabilities.publicSurface().canSee(ungated));
    }

    @Test
    void theOfficerCapabilityIsWhatUnlocksOfficerTiles() {
        KpiDefinition officerTile = new KpiDefinition();
        officerTile.setRequiredActionUrl(AnalyticsCapabilities.OFFICER);

        assertTrue(AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.OFFICER).canSee(officerTile));
        assertFalse(AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.QUERY).canSee(officerTile));
    }

    @Test
    void thePublicSurfaceSeesPublicTilesAndHoldsNoCapability() {
        KpiDefinition publicTile = new KpiDefinition();
        publicTile.setRequiredActionUrl(AnalyticsCapabilities.QUERY);
        publicTile.setPublicTile(true);
        KpiDefinition employeeTile = new KpiDefinition();
        employeeTile.setRequiredActionUrl(AnalyticsCapabilities.QUERY);

        AnalyticsCapabilities anonymous = AnalyticsCapabilities.publicSurface();

        assertTrue(anonymous.canSee(publicTile));
        assertFalse(anonymous.canSee(employeeTile), "public is additive, never an employee grant");
        assertTrue(anonymous.granted().isEmpty());
        assertFalse(anonymous.allowsOfficerPii());
    }

    @Test
    void anEmployeeGrantDoesNotDependOnTheTileBeingPublic() {
        // The marker widens the audience; it never narrows it.
        KpiDefinition publicTile = new KpiDefinition();
        publicTile.setRequiredActionUrl(AnalyticsCapabilities.QUERY);
        publicTile.setPublicTile(true);

        assertTrue(AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.QUERY).canSee(publicTile));
    }

    @Test
    void packsFollowTheSameRuleAsTiles() {
        DashboardPack employeePack = new DashboardPack();
        employeePack.setRequiredActionUrl(AnalyticsCapabilities.QUERY);
        DashboardPack publicPack = new DashboardPack();
        publicPack.setPublicPack(true);

        assertTrue(AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.QUERY).canSee(employeePack));
        assertFalse(AnalyticsCapabilities.publicSurface().canSee(employeePack));
        assertTrue(AnalyticsCapabilities.publicSurface().canSee(publicPack));
        assertFalse(AnalyticsCapabilityFixtures.full().canSee(publicPack));
    }

    @Test
    void resolvesEveryCapabilityInOneAccessControlCall() {
        // The underlying lookup returns the caller's whole action list, so asking per url would
        // fetch the same payload nine times — on an endpoint every employee's home page hits.
        when(registry.visibleActionUrls(any(), eq(TENANT))).thenReturn(java.util.Set.of());

        service.resolve(requestInfo(), TENANT);

        verify(registry, times(1)).visibleActionUrls(any(), eq(TENANT));
        verify(registry, never()).isActionVisible(anyString(), any(), anyString());
    }

    @Test
    void aCallerWithNoRolesIsDeniedRatherThanReportedAsAnOutage() {
        // An anonymous request to an employee endpoint is a denial. Letting the registry's refusal
        // surface would answer it 503 "service unavailable" instead of 403.
        AnalyticsCapabilities capabilities = service.resolve(RequestInfo.builder().build(), TENANT);

        assertTrue(capabilities.granted().isEmpty());
        verify(registry, never()).visibleActionUrls(any(), anyString());
    }

    private static RequestInfo requestInfo() {
        User user = new User();
        user.setUuid("emp-1");
        user.setRoles(java.util.List.of(Role.builder().code("SUPERVISOR").build()));
        return RequestInfo.builder().authToken("token").userInfo(user).build();
    }
}
