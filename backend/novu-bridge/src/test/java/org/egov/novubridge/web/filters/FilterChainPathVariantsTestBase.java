package org.egov.novubridge.web.filters;

import org.egov.novubridge.config.MainConfiguration;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.account.ChannelReadiness;
import org.egov.novubridge.service.account.MessageSendService;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailabilities;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.web.controllers.ContractController;
import org.egov.novubridge.web.controllers.MessageController;
import org.egov.novubridge.web.controllers.ProviderController;
import org.egov.novubridge.web.controllers.TenantAccountController;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.autoconfigure.http.HttpMessageConvertersAutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.error.ErrorMvcAutoConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review B1 of #2343, through the REAL request path: embedded Tomcat (its path-parameter
 * stripping, decoding and normalization), the filters exactly as {@link MainConfiguration}
 * registers them, the DispatcherServlet and the real controllers (their services mocked). Requests
 * are written byte for byte on a socket, so no client library normalizes the paths first.
 *
 * <p>Every machine route of #2203 is sent in every spelling a lenient reader could map onto it
 * (a {@code ;} parameter on each segment, an encoded character, another case, dot segments,
 * {@code //}, a trailing slash, encoded slashes) without its token, and with the other API's token:
 * none may reach a controller. The controls prove the variants are live: the same encoded spelling
 * WITH the token does reach the controller, and (without the firewall) a {@code ;x} spelling of a
 * public path is served.
 *
 * <p>Two contexts run it: {@link FilterChainPathVariantsTest} as deployed, and
 * {@link FilterChainPathVariantsWithoutFirewallTest} with {@link RequestFirewallFilter} disabled, so
 * the auth filters are shown to hold on their own.
 */
abstract class FilterChainPathVariantsTestBase {

    static final String ADMIN = "admin-token-0123456789";
    static final String SEND = "send-token-0123456789";
    static final String CTX = "/novu-bridge";

    /** Just the web layer: no Kafka, no database, no tracer. */
    @SpringBootConfiguration
    @ImportAutoConfiguration({PropertyPlaceholderAutoConfiguration.class, ServletWebServerFactoryAutoConfiguration.class,
            DispatcherServletAutoConfiguration.class, WebMvcAutoConfiguration.class,
            HttpMessageConvertersAutoConfiguration.class, JacksonAutoConfiguration.class, ErrorMvcAutoConfiguration.class})
    @Import({MainConfiguration.class, TenantAccountsConfiguration.class, TenantAccountController.class,
            MessageController.class, ProviderController.class, ContractController.class})
    static class WebLayer {
        /** Built here rather than imported: the class's own @Import pulls in the tracer. */
        @Bean
        NovuBridgeConfiguration novuBridgeConfiguration() {
            return new NovuBridgeConfiguration();
        }
    }

    @LocalServerPort
    int port;

    // The controllers' collaborators: an invocation on any of them means a request got through.
    @MockBean
    TenantAccountService accounts;
    @MockBean
    ChannelReadiness readiness;
    @MockBean
    MessageSendService sender;
    @MockBean
    NovuClient novuClient;
    @MockBean
    DeliveryProviderRegistry providerRegistry;
    @MockBean
    DispatchLogRepository dispatchLogRepository;
    @MockBean
    DispatchPipelineService pipeline;
    @MockBean
    TwilioTemplateSyncService twilioTemplateSyncService;
    @MockBean
    ProviderCatalog catalog;
    @MockBean
    ChannelPolicyClient channelPolicy;
    @MockBean
    ProviderAvailability providerAvailability;
    @MockBean
    ProviderAvailabilities availabilities;
    /** egov-user introspection, for ProxyAuthFilter. */
    @MockBean
    RestTemplate restTemplate;

    /** Whether {@link RequestFirewallFilter} is in this context. */
    abstract boolean firewall();

    record Route(String method, String path, String token, String otherToken) {
    }

    /** Every #2203 machine route, its token, and the token of the other API. */
    static final List<Route> MACHINE_ROUTES = List.of(
            new Route("GET", "/novu-adapter/v1/tenants", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/tenants/_backfill", ADMIN, SEND),
            new Route("GET", "/novu-adapter/v1/tenants/acme", ADMIN, null),
            new Route("POST", "/novu-adapter/v1/tenants/acme/_provision", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/tenants/acme/_deprovision", ADMIN, SEND),
            new Route("GET", "/novu-adapter/v1/tenants/acme/providers", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/tenants/acme/providers", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/tenants/acme/providers/_update", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/tenants/acme/providers/_delete", ADMIN, SEND),
            new Route("POST", "/novu-adapter/v1/messages/_send", SEND, ADMIN),
            new Route("POST", "/novu-adapter/v1/messages/_dispatch", SEND, ADMIN));

    /** Configurator routes ProxyAuthFilter must authenticate (and, for _update, hold to the admin tier). */
    static final List<Route> CONFIGURATOR_ROUTES = List.of(
            new Route("GET", "/novu-adapter/v1/providers/catalog", null, null),
            new Route("POST", "/novu-adapter/v1/providers/_update", null, null),
            new Route("POST", "/novu-adapter/v1/providers/test-send", null, null));

    /**
     * The spellings of {@code path} (inside the context) a lenient reader could map onto it: per
     * segment a {@code ;} parameter (also encoded), an encoded first character, upper case, dot
     * segments (also encoded), an empty segment; for the whole path a trailing slash or {@code ;},
     * and encoded or back slashes.
     */
    static List<String> variants(String path) {
        String[] segments = (CTX + path).substring(1).split("/");
        Set<String> out = new LinkedHashSet<>();
        for (int i = 0; i < segments.length; i++) {
            String s = segments[i];
            out.add(join(segments, i, s + ";x"));
            out.add(join(segments, i, s + ";jsessionid=0123"));
            out.add(join(segments, i, s + ";"));
            out.add(join(segments, i, s + "%3Bx"));
            out.add(join(segments, i, s + "%3bx"));
            out.add(join(segments, i, String.format("%%%02X", (int) s.charAt(0)) + s.substring(1)));
            out.add(join(segments, i, s.toUpperCase(Locale.ROOT)));
            out.add(join(segments, i, "./" + s));
            out.add(join(segments, i, "%2e/" + s));
            out.add(join(segments, i, "zz/../" + s));
            out.add(join(segments, i, "zz/%2e%2e/" + s));
            out.add(join(segments, i, "zz/..;x/" + s));
            out.add(join(segments, i, "/" + s));
        }
        String full = CTX + path;
        out.add(full + "/");
        out.add(full + "//");
        out.add(full + "/;x");
        out.add(full + "/.");
        out.add(full.replace("/v1/", "/v1%2F"));
        out.add(full.replace("/v1/", "/v1%2f"));
        out.add(full.replace("/v1/", "/v1%5C"));
        out.add(full.replace("/v1/", "/v1\\"));
        return new ArrayList<>(out);
    }

    private static String join(String[] segments, int at, String replacement) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            sb.append('/').append(i == at ? replacement : segments[i]);
        }
        return sb.toString();
    }

    record Reply(int status, String text) {
    }

    /** One HTTP/1.1 request, written as given: the request target is not touched. */
    Reply send(String method, String target, Map<String, String> headers) throws IOException {
        String body = "POST".equals(method) ? "{}" : "";
        StringBuilder request = new StringBuilder(method).append(' ').append(target).append(" HTTP/1.1\r\n")
                .append("Host: localhost\r\nConnection: close\r\n");
        headers.forEach((k, v) -> request.append(k).append(": ").append(v).append("\r\n"));
        if (!body.isEmpty()) {
            request.append("Content-Type: application/json\r\nContent-Length: ").append(body.length()).append("\r\n");
        }
        request.append("\r\n").append(body);
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10_000);
            socket.getOutputStream().write(request.toString().getBytes(StandardCharsets.ISO_8859_1));
            socket.getOutputStream().flush();
            String raw = new String(socket.getInputStream().readAllBytes(), StandardCharsets.ISO_8859_1);
            if (!raw.startsWith("HTTP/1.1 ")) {
                fail("no HTTP response for " + method + " " + target + ": " + raw);
            }
            return new Reply(Integer.parseInt(raw.substring(9, 12)), raw);
        }
    }

    Reply internal(String method, String target, String token) throws IOException {
        return send(method, target, token == null ? Map.of() : Map.of(InternalAuthFilter.HEADER, token));
    }

    /** An invocation on any controller collaborator. */
    private List<String> reached() {
        List<String> calls = new ArrayList<>();
        for (Object mock : new Object[] {accounts, readiness, sender, novuClient, providerRegistry, dispatchLogRepository,
                twilioTemplateSyncService, catalog, channelPolicy, providerAvailability, availabilities, pipeline}) {
            Mockito.mockingDetails(mock).getInvocations().forEach(i -> calls.add(i.toString()));
        }
        return calls;
    }

    private void assertRefused(String method, String target, String who, Reply reply) {
        String what = method + " " + target + " (" + who + ")";
        List<String> calls = reached();
        Mockito.clearInvocations(accounts, readiness, sender, novuClient, providerRegistry, dispatchLogRepository,
                twilioTemplateSyncService, catalog, channelPolicy, providerAvailability, availabilities, pipeline);
        if (!calls.isEmpty()) {
            fail(what + " reached a controller (HTTP " + reply.status() + "): " + calls);
        }
        int s = reply.status();
        if (!(s == 400 || s == 401 || s == 403 || s == 404)) {
            fail(what + " answered HTTP " + s + ", expected a refusal:\n" + reply.text());
        }
        // Only where Tomcat maps the context (it 404s `/novu-bridge%3Bx/..` itself, before any filter).
        boolean inContext = target.startsWith(CTX + "/") || target.startsWith(CTX + ";");
        if (firewall() && inContext && RequestPaths.rejection(target) != null) {
            assertEquals(400, s, what + " is not a plain path: the firewall answers 400\n" + reply.text());
        }
    }

    // ---------------------------------------------------------------------------- controls

    @Test
    void controls_thePlainRoutesWithTheirTokens_reachTheControllers() throws IOException {
        when(accounts.provision("acme")).thenReturn(new TenantAccountService.ProvisionResult(Map.of("status", "PROVISIONED"),
                false, List.of()));
        assertEquals(200, internal("POST", CTX + "/novu-adapter/v1/tenants/acme/_provision", ADMIN).status());
        verify(accounts).provision("acme");

        when(sender.send(any())).thenReturn(new MessageSendService.Outcome(HttpStatus.OK, Map.of("status", "SENT")));
        assertEquals(200, internal("POST", CTX + "/novu-adapter/v1/messages/_send", SEND).status());
        verify(sender).send(any());

        // The one read the send token may make.
        internal("GET", CTX + "/novu-adapter/v1/tenants/acme", SEND);
        verify(accounts).find("acme");
    }

    @Test
    void controls_anEncodedSpellingIsMappedByTheControllers_soItMustNeedTheTokenToo() throws IOException {
        when(accounts.provision("acme")).thenReturn(new TenantAccountService.ProvisionResult(Map.of("status", "PROVISIONED"),
                false, List.of()));
        // %74 is 't': Spring MVC decodes each segment before matching, so this IS the provision route.
        assertEquals(200, internal("POST", CTX + "/novu-adapter/v1/%74enants/acme/_provision", ADMIN).status());
        verify(accounts).provision("acme");
        Mockito.clearInvocations(accounts);
        assertRefused("POST", CTX + "/novu-adapter/v1/%74enants/acme/_provision", "no token",
                internal("POST", CTX + "/novu-adapter/v1/%74enants/acme/_provision", null));
    }

    @Test
    void controls_aPathParameterIsStrippedByTomcatAndSpring_soWithoutTheFirewallAPublicPathIsServed() throws IOException {
        Reply reply = send("GET", CTX + "/novu-adapter/v1;x/contract/envelope", Map.of());
        if (firewall()) {
            assertEquals(400, reply.status(), reply.text());
            assertTrue(reply.text().contains(RequestFirewallFilter.CODE), reply.text());
        } else {
            // The mapping the review exploited: `v1;x` is `v1` to Tomcat and to Spring MVC.
            assertEquals(200, reply.status(), reply.text());
        }
        assertEquals(200, send("GET", CTX + "/novu-adapter/v1/contract/envelope", Map.of()).status());
    }

    // ---------------------------------------------------------------------------- the sweep

    @Test
    void noSpellingOfAMachineRoute_reachesItsController_withoutItsToken() throws IOException {
        int sent = 0;
        for (Route route : MACHINE_ROUTES) {
            for (String target : variants(route.path())) {
                assertRefused(route.method(), target, "no token", internal(route.method(), target, null));
                sent++;
                if (route.otherToken() != null) {
                    assertRefused(route.method(), target, "the other API's token",
                            internal(route.method(), target, route.otherToken()));
                    sent++;
                }
                assertRefused(route.method(), target, "a DIGIT session",
                        send(route.method(), target, Map.of("Authorization", "Bearer a-digit-session")));
                sent++;
            }
        }
        assertTrue(sent > 1_000, "the sweep must be broad, sent " + sent);
    }

    @Test
    void noSpellingOfAConfiguratorRoute_reachesItsController_withoutABearerToken() throws IOException {
        for (Route route : CONFIGURATOR_ROUTES) {
            for (String target : variants(route.path())) {
                assertRefused(route.method(), target, "no bearer", send(route.method(), target, Map.of()));
            }
        }
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void noSpellingOfAnOwningStateRoute_letsAnotherStatesAdminThrough() throws IOException {
        // An admin, but at `ke`, which does not own this deployment's providers (pg does).
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("type", "EMPLOYEE", "tenantId", "ke",
                        "roles", List.of(Map.of("code", "MDMS_ADMIN", "tenantId", "ke")))));
        for (String path : List.of("/novu-adapter/v1/providers/_update", "/novu-adapter/v1/providers/test-send")) {
            for (String target : variants(path)) {
                assertRefused("POST", target, "admin of another state",
                        send("POST", target, Map.of("Authorization", "Bearer admin-of-ke")));
            }
        }
        // Control: the broad tier lets the same caller read the catalog.
        when(catalog.types()).thenReturn(List.of());
        assertEquals(200, send("GET", CTX + "/novu-adapter/v1/providers/catalog",
                Map.of("Authorization", "Bearer admin-of-ke")).status());
        verify(catalog).types();
    }
}
