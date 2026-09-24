package org.egov.novubridge.web.filters;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Plain-JUnit coverage of the server-side proxy auth gate: missing token → 401,
 * valid EMPLOYEE with an allowlisted role → chain invoked, valid token with a
 * disjoint role → 403, egov-user rejecting the token → 401.
 */
class ProxyAuthFilterTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private ProxyAuthFilter filter;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setProxyAuthEnabled(true);
        config.setUserHost("http://egov-user:8107");
        config.setUserDetailsPath("/user/_details");
        config.setProxyAllowedRoles(List.of("EMPLOYEE", "GRO", "PGR_LME"));
        config.setProxyAdminRoles(List.of("SUPERUSER", "MDMS_ADMIN", "ACCOUNT_ADMIN"));
        filter = new ProxyAuthFilter(restTemplate, config);
    }

    private MockHttpServletRequest logsRequest() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("GET");
        req.setServletPath("/novu-adapter/v1/logs");
        req.setRequestURI("/novu-bridge/novu-adapter/v1/logs");
        return req;
    }

    private MockHttpServletRequest preferencesRequest() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("GET");
        req.setServletPath("/novu-adapter/v1/preferences");
        req.setRequestURI("/novu-bridge/novu-adapter/v1/preferences");
        return req;
    }

    private MockHttpServletRequest providersCreateRequest() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("POST");
        req.setServletPath("/novu-adapter/v1/providers");
        req.setRequestURI("/novu-bridge/novu-adapter/v1/providers");
        return req;
    }

    private MockHttpServletRequest dispatchTestTriggerRequest() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("POST");
        req.setServletPath("/novu-adapter/v1/dispatch/_test-trigger");
        req.setRequestURI("/novu-bridge/novu-adapter/v1/dispatch/_test-trigger");
        return req;
    }

    @Test
    void noAuthHeader_returns401_chainNotInvoked() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(logsRequest(), res, chain);

        assertEquals(401, res.getStatus());
        assertNull(chain.getRequest()); // downstream never reached
    }

    @Test
    void preferencesWithoutToken_isGated_returns401() throws Exception {
        // Regression: /preferences must be auth-gated like /logs and /integrations.
        // (shouldNotFilter previously excluded it, serving it unauthenticated.)
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(preferencesRequest(), res, chain);

        assertEquals(401, res.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void providersCreateWithoutToken_isGated_returns401() throws Exception {
        // The /providers self-service management paths (POST) must be auth-gated
        // like /logs, /integrations and /preferences — they push credentials to Novu.
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(providersCreateRequest(), res, chain);

        assertEquals(401, res.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void dispatchTestTriggerWithoutToken_isGated_returns401() throws Exception {
        // Regression: the POST /dispatch diagnostics (_validate/_dry-run/_test-trigger)
        // must be auth-gated like the other /novu-adapter/v1 endpoints. _test-trigger
        // sends a real Novu SMS/WhatsApp/Email, so it must never run unauthenticated.
        // (shouldNotFilter previously excluded /dispatch, serving it unauthenticated.)
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(dispatchTestTriggerRequest(), res, chain);

        assertEquals(401, res.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void validEmployeeWithAllowedRole_invokesChain() throws Exception {
        stubUserDetails(Map.of("type", "EMPLOYEE", "roles", List.of(Map.of("code", "GRO"))));
        MockHttpServletRequest req = logsRequest();
        req.addHeader("Authorization", "Bearer good-token");
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertNotNull(chain.getRequest()); // reached downstream
        assertEquals(200, res.getStatus());
    }

    @Test
    void validTokenButRoleNotAllowed_returns403() throws Exception {
        stubUserDetails(Map.of("type", "EMPLOYEE", "roles", List.of(Map.of("code", "SOME_OTHER_ROLE"))));
        MockHttpServletRequest req = logsRequest();
        req.addHeader("Authorization", "Bearer good-token");
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertEquals(403, res.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void egovUserRejectsToken_returns401() throws Exception {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenThrow(new RestClientException("401 Unauthorized"));
        MockHttpServletRequest req = logsRequest();
        req.addHeader("Authorization", "Bearer bad-token");
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertEquals(401, res.getStatus());
        assertNull(chain.getRequest());
    }

    // ---- the admin tier: create / _update / _delete / test-send / _dry-run / _resolve ----

    private static MockHttpServletRequest post(String path) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("POST");
        req.setServletPath(path);
        req.setRequestURI("/novu-bridge" + path);
        return req;
    }

    /**
     * Run one request with the given roles, held at the state tenant {@code pg} as egov-user
     * returns them (every role object carries its tenantId); returns the response for assertions.
     */
    private MockHttpServletResponse call(MockHttpServletRequest req, MockFilterChain chain, String... roles) throws Exception {
        List<Map<String, Object>> roleList = java.util.Arrays.stream(roles)
                .map(r -> Map.<String, Object>of("code", r, "tenantId", "pg")).toList();
        stubUserDetails(Map.of("type", "EMPLOYEE", "tenantId", "pg", "roles", roleList));
        req.addHeader("Authorization", "Bearer good-token");
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, chain);
        return res;
    }

    @Test
    void anAdminRolePassesEveryProviderManagementCall() throws Exception {
        for (String path : List.of("/novu-adapter/v1/providers",
                "/novu-adapter/v1/providers/_update",
                "/novu-adapter/v1/providers/_delete",
                "/novu-adapter/v1/providers/test-send",
                "/novu-adapter/v1/dispatch/_dry-run")) {
            MockFilterChain chain = new MockFilterChain();
            // A fresh filter per path: the token cache is keyed by token, not by path.
            filter = new ProxyAuthFilter(restTemplate, config);
            MockHttpServletResponse res = call(post(path), chain, "MDMS_ADMIN");

            assertNotNull(chain.getRequest(), path + " must reach the controller for an admin");
            assertEquals(200, res.getStatus(), path);
        }
    }

    @Test
    void aNonAdminEmployeeIsRefusedEveryProviderManagementCall() throws Exception {
        for (String path : List.of("/novu-adapter/v1/providers",
                "/novu-adapter/v1/providers/_update",
                "/novu-adapter/v1/providers/_delete",
                "/novu-adapter/v1/providers/test-send",
                "/novu-adapter/v1/dispatch/_dry-run")) {
            MockFilterChain chain = new MockFilterChain();
            filter = new ProxyAuthFilter(restTemplate, config);
            // GRO is on the BROAD allowlist — it may read the screens — but rotating or
            // deleting a provider's credentials, or sending arbitrary text through the
            // government sender, is not its business.
            MockHttpServletResponse res = call(post(path), chain, "GRO");

            assertEquals(403, res.getStatus(), path);
            assertNull(chain.getRequest(), path + " must not reach the controller");
            assertTrue(res.getContentAsString().contains("NB_ADMIN_ROLE_REQUIRED"),
                    "the refusal must carry a machine-readable code, not just a status: "
                            + res.getContentAsString());
        }
    }

    @Test
    void aNonAdminEmployeeStillReadsTheCatalogAndTheIntegrationsList() throws Exception {
        // The narrow gate is a list of exact paths. Everything else on /providers — and every
        // read-only endpoint — keeps the broad allowlist it has always had.
        for (MockHttpServletRequest req : List.of(
                get("/novu-adapter/v1/providers/catalog"),
                get("/novu-adapter/v1/integrations"),
                get("/novu-adapter/v1/logs"),
                post("/novu-adapter/v1/providers/verify"))) {
            MockFilterChain chain = new MockFilterChain();
            filter = new ProxyAuthFilter(restTemplate, config);
            MockHttpServletResponse res = call(req, chain, "GRO");

            assertNotNull(chain.getRequest(), req.getServletPath() + " must stay open to a GRO");
            assertEquals(200, res.getStatus(), req.getServletPath());
        }
    }

    private static MockHttpServletRequest get(String path) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod("GET");
        req.setServletPath(path);
        req.setRequestURI("/novu-bridge" + path);
        return req;
    }

    @Test
    void theAdminTierIsCheckedOnACachedTokenToo() throws Exception {
        // Regression: the 60s token cache short-circuits introspection. If the admin check
        // lived only on the introspection path, a GRO could read the Logs screen once and
        // then delete a provider for the next minute.
        MockFilterChain readChain = new MockFilterChain();
        assertEquals(200, call(logsRequest(), readChain, "GRO").getStatus());
        assertNotNull(readChain.getRequest());

        MockHttpServletRequest req = post("/novu-adapter/v1/providers/_delete");
        req.addHeader("Authorization", "Bearer good-token");   // the very same token
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(req, res, chain);

        assertEquals(403, res.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void withProxyAuthDisabled_providerManagementBehavesExactlyAsBefore() throws Exception {
        // The local-dev escape hatch is unchanged: no token, no roles, no admin check.
        config.setProxyAuthEnabled(false);
        filter = new ProxyAuthFilter(restTemplate, config);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(post("/novu-adapter/v1/providers/_delete"), res, chain);

        assertNotNull(chain.getRequest());
        assertEquals(200, res.getStatus());
        verifyNoInteractions(restTemplate);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubUserDetails(Map<String, Object> body) {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(body));
    }
}
