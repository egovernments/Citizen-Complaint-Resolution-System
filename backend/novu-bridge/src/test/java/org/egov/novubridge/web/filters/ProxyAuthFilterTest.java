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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
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

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubUserDetails(Map<String, Object> body) {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(body));
    }
}
