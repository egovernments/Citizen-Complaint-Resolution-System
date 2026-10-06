package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.ResolutionOutcome;
import org.egov.novubridge.util.ResponseInfoFactory;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.DispatchDryRunRequest;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.novubridge.web.models.ThinEventResolveRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review (5): {@code _resolve} and {@code _dry-run} are scoped to the event's tenant, so the admin
 * of each root can preview its own migration (migrate-notifications.py, one root at a time) while
 * the provider calls stay with the state that owns the providers. {@code pg} owns them here;
 * {@code acme} is another root on the same box.
 */
class DispatchControllerTenantScopeTest {

    private DispatchPipelineService pipeline;
    private NotificationResolver resolver;
    private DispatchController controller;

    @BeforeEach
    void setUp() {
        pipeline = mock(DispatchPipelineService.class);
        resolver = mock(NotificationResolver.class);
        when(resolver.resolve(any(ThinEvent.class), anyBoolean())).thenReturn(new ResolutionOutcome());
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setCoreSmsDefaultTenant("pg");
        controller = new DispatchController(pipeline, resolver, mock(ResponseInfoFactory.class), config);
    }

    @AfterEach
    void clear() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** As ProxyAuthFilter hands it over: an admin role held at {@code state}. */
    private static void callerAdminAt(String state) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(ProxyAuthFilter.CALLER_ATTRIBUTE,
                new ProxyAuthFilter.Caller(Set.of("MDMS_ADMIN"), Set.of(state), Set.of(state)));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static ThinEventResolveRequest resolveFor(String tenantId) {
        return ThinEventResolveRequest.builder().event(ThinEvent.builder().tenantId(tenantId).build()).build();
    }

    private static DispatchDryRunRequest dryRunFor(String tenantId, boolean send) {
        return DispatchDryRunRequest.builder().send(send)
                .event(NotificationEvent.builder().tenantId(tenantId).build()).build();
    }

    private static void assertForbidden(Runnable call, String inMessage) {
        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class, call::run);
        assertEquals(HttpStatus.FORBIDDEN, refusal.status());
        assertEquals("NB_TENANT_NOT_ALLOWED", refusal.code());
        assertTrue(refusal.getMessage().contains(inMessage), refusal.getMessage());
    }

    @Test
    void theAdminOfARootResolvesItsOwnTenants_notAnotherRoots() {
        callerAdminAt("acme");

        assertEquals(HttpStatus.OK, controller.resolve(resolveFor("acme.city")).getStatusCode());
        assertEquals(HttpStatus.OK, controller.resolve(resolveFor("acme")).getStatusCode());
        verify(resolver, times(2)).resolve(any(ThinEvent.class), anyBoolean());

        assertForbidden(() -> controller.resolve(resolveFor("pg.citya")), "(pg)");
        assertForbidden(() -> controller.resolve(resolveFor(null)), "none given");
        verify(resolver, times(2)).resolve(any(ThinEvent.class), anyBoolean());   // the refusals never resolved
    }

    @Test
    void theOwningStatesAdminResolvesAnyRoot() {
        callerAdminAt("pg");
        assertEquals(HttpStatus.OK, controller.resolve(resolveFor("acme.city")).getStatusCode());
    }

    @Test
    void dryRunValidatesForTheOwnRoot_butSendingStaysWithTheOwningState() {
        callerAdminAt("acme");
        assertEquals(HttpStatus.OK, controller.dryRun(dryRunFor("acme.city", false)).getStatusCode());
        assertForbidden(() -> controller.dryRun(dryRunFor("pg.citya", false)), "(pg)");
        // A real send of the caller's wording through the shared providers, like test-send.
        assertForbidden(() -> controller.dryRun(dryRunFor("acme.city", true)), "send:true");
        verify(pipeline, never()).process(any(), org.mockito.ArgumentMatchers.eq(true), any());

        callerAdminAt("pg");
        assertEquals(HttpStatus.OK, controller.dryRun(dryRunFor("acme.city", true)).getStatusCode());
        verify(pipeline).process(any(), org.mockito.ArgumentMatchers.eq(true), any());
    }

    @Test
    void withProxyAuthOff_thereIsNoCallerAndNothingToScope() {
        assertEquals(HttpStatus.OK, controller.resolve(resolveFor("pg.citya")).getStatusCode());
        assertEquals(HttpStatus.OK, controller.dryRun(dryRunFor("pg.citya", true)).getStatusCode());
    }

    @Test
    void aRefusalRendersAsA403WithTheErrorsShape() {
        callerAdminAt("acme");
        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class,
                () -> controller.resolve(resolveFor("pg")));
        var response = controller.refused(refusal);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertTrue(String.valueOf(response.getBody()).contains("NB_TENANT_NOT_ALLOWED"), String.valueOf(response.getBody()));
    }
}
