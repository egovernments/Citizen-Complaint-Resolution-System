package org.egov.novubridge.web.filters;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.egov.novubridge.service.account.TenantAccountService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
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
import static org.mockito.Mockito.when;

/**
 * #2203 authentication: the machine APIs take only their internal tokens (never a DIGIT
 * session), and a workspace with its own Novu organization is managed by its own admins only.
 */
class TenantAccountAuthTest {

    private static final String ADMIN = "admin-token-0123456789";
    private static final String SEND = "send-token-0123456789";

    private TenantAccountsConfiguration accounts;
    private InternalAuthFilter internal;

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;
    private TenantAccountService tenantAccounts;
    private ProxyAuthFilter proxy;

    @BeforeEach
    void setUp() {
        accounts = new TenantAccountsConfiguration();
        accounts.setInternalAdminToken(ADMIN);
        accounts.setInternalSendToken(SEND);
        internal = new InternalAuthFilter(accounts);

        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setProxyAuthEnabled(true);
        config.setUserHost("http://egov-user:8107");
        config.setUserDetailsPath("/user/_details");
        config.setProxyAllowedRoles(List.of("EMPLOYEE", "GRO"));
        config.setProxyAdminRoles(List.of("SUPERUSER", "MDMS_ADMIN", "ACCOUNT_ADMIN"));
        config.setCoreSmsDefaultTenant("pg");
        tenantAccounts = mock(TenantAccountService.class);
        when(tenantAccounts.isProvisioned("acme")).thenReturn(true);
        when(tenantAccounts.isProvisioned("acme.city")).thenReturn(true);
        proxy = new ProxyAuthFilter(restTemplate, config, tenantAccounts);
    }

    private static MockHttpServletRequest request(String method, String path, String token) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setMethod(method);
        req.setServletPath(path);
        req.setRequestURI("/novu-bridge" + path);
        if (token != null) {
            req.addHeader(InternalAuthFilter.HEADER, token);
        }
        return req;
    }

    private MockHttpServletResponse internal(MockHttpServletRequest req, MockFilterChain chain) throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        internal.doFilter(req, res, chain);
        return res;
    }

    // ---------------------------------------------------------------- InternalAuthFilter

    @Test
    void theAdminApi_takesTheAdminToken_andRefusesEverythingElse() throws Exception {
        String path = "/novu-adapter/v1/tenants/acme/_provision";
        MockFilterChain ok = new MockFilterChain();
        assertEquals(200, internal(request("POST", path, ADMIN), ok).getStatus());
        assertNotNull(ok.getRequest());

        for (String token : new String[] {null, "wrong", SEND, "Bearer " + ADMIN}) {
            MockFilterChain chain = new MockFilterChain();
            MockHttpServletResponse res = internal(request("POST", path, token), chain);
            assertEquals(401, res.getStatus(), String.valueOf(token));
            assertNull(chain.getRequest(), String.valueOf(token));
        }
    }

    @Test
    void aDigitUserToken_neverOpensTheMachineApis() throws Exception {
        MockHttpServletRequest req = request("POST", "/novu-adapter/v1/messages/_send", null);
        req.addHeader("Authorization", "Bearer a-valid-digit-session");
        MockFilterChain chain = new MockFilterChain();
        assertEquals(401, internal(req, chain).getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void send_takesOnlyTheSendToken() throws Exception {
        String path = "/novu-adapter/v1/messages/_send";
        MockFilterChain ok = new MockFilterChain();
        assertEquals(200, internal(request("POST", path, SEND), ok).getStatus());
        MockFilterChain admin = new MockFilterChain();
        assertEquals(401, internal(request("POST", path, ADMIN), admin).getStatus());
        assertNull(admin.getRequest());
    }

    @Test
    void theSendToken_mayReadATenantsStatus_andNothingElseUnderTenants() throws Exception {
        MockFilterChain status = new MockFilterChain();
        assertEquals(200, internal(request("GET", "/novu-adapter/v1/tenants/acme", SEND), status).getStatus());
        assertNotNull(status.getRequest());
        for (String[] call : new String[][] {{"GET", "/novu-adapter/v1/tenants/acme/providers"},
                {"POST", "/novu-adapter/v1/tenants/acme/providers"}, {"GET", "/novu-adapter/v1/tenants"},
                {"POST", "/novu-adapter/v1/tenants/acme/_deprovision"}}) {
            MockFilterChain chain = new MockFilterChain();
            assertEquals(401, internal(request(call[0], call[1], SEND), chain).getStatus(), call[1]);
            assertNull(chain.getRequest(), call[1]);
        }
    }

    @Test
    void aBlankToken_switchesItsApiOff() throws Exception {
        accounts.setInternalAdminToken("");
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = internal(request("POST", "/novu-adapter/v1/tenants/acme/_provision", ""), chain);
        assertEquals(403, res.getStatus());
        assertTrue(res.getContentAsString().contains("NB_INTERNAL_API_DISABLED"));
        assertNull(chain.getRequest());

        accounts.setInternalSendToken(" ");
        MockFilterChain send = new MockFilterChain();
        assertEquals(403, internal(request("POST", "/novu-adapter/v1/messages/_send", " "), send).getStatus());
    }

    @Test
    void otherPaths_areNotThisFiltersBusiness() throws Exception {
        MockFilterChain chain = new MockFilterChain();
        assertEquals(200, internal(request("GET", "/novu-adapter/v1/tenantsx", null), chain).getStatus());
        assertNotNull(chain.getRequest());
    }

    // ---------------------------------------------------------------- ProxyAuthFilter, own organization

    @SuppressWarnings({"unchecked", "rawtypes"})
    private MockHttpServletResponse asAdminOf(String tenant, MockHttpServletRequest req, MockFilterChain chain) throws Exception {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(), eq(Map.class)))
                .thenReturn((ResponseEntity) ResponseEntity.ok(Map.of("type", "EMPLOYEE", "tenantId", tenant,
                        "roles", List.of(Map.of("code", "ACCOUNT_ADMIN", "tenantId", tenant)))));
        req.addHeader("Authorization", "Bearer good-token-" + tenant);
        MockHttpServletResponse res = new MockHttpServletResponse();
        proxy.doFilter(req, res, chain);
        return res;
    }

    private static MockHttpServletRequest providerWrite(String path, String selector) {
        MockHttpServletRequest req = request("POST", path, null);
        if (selector != null) {
            req.setParameter("tenantId", selector);
        }
        return req;
    }

    @Test
    void aWorkspaceAdmin_managesItsOwnOrganization_withoutBeingListedAsAnOwningState() throws Exception {
        for (String path : List.of("/novu-adapter/v1/providers", "/novu-adapter/v1/providers/_update",
                "/novu-adapter/v1/providers/_delete", "/novu-adapter/v1/providers/test-send")) {
            MockFilterChain chain = new MockFilterChain();
            MockHttpServletResponse res = asAdminOf("acme", providerWrite(path, "acme"), chain);
            assertEquals(200, res.getStatus(), path);
            assertNotNull(chain.getRequest(), path);
        }
    }

    @Test
    void withoutTheSelector_theWorkspaceAdminIsStillRefused_theSharedProvidersAreNotTheirs() throws Exception {
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = asAdminOf("acme", providerWrite("/novu-adapter/v1/providers", null), chain);
        assertEquals(403, res.getStatus());
        assertTrue(res.getContentAsString().contains("only an admin of pg"), res.getContentAsString());
        assertNull(chain.getRequest());
    }

    @Test
    void theOwningStatesAdmin_cannotManageAWorkspacesOwnOrganization() throws Exception {
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = asAdminOf("pg", providerWrite("/novu-adapter/v1/providers/_delete", "acme"), chain);
        assertEquals(403, res.getStatus());
        assertTrue(res.getContentAsString().contains("NB_TENANT_NOT_ALLOWED"));
        assertTrue(res.getContentAsString().contains("held at acme"), res.getContentAsString());
        assertNull(chain.getRequest());
    }

    @Test
    void anUnprovisionedWorkspace_keepsTodaysRule() throws Exception {
        when(tenantAccounts.isProvisioned("globex")).thenReturn(false);
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = asAdminOf("globex", providerWrite("/novu-adapter/v1/providers", "globex"), chain);
        assertEquals(403, res.getStatus());
        assertTrue(res.getContentAsString().contains("only an admin of pg"), res.getContentAsString());
    }

    @Test
    void anotherWorkspacesAdmin_isRefused() throws Exception {
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = asAdminOf("globex", providerWrite("/novu-adapter/v1/providers", "acme.city"), chain);
        assertEquals(403, res.getStatus());
        assertNull(chain.getRequest());
    }
}
