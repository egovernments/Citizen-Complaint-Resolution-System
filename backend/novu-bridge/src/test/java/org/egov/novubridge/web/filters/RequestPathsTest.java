package org.egov.novubridge.web.filters;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/** The canonical path every filter decides on, and what a plain path never contains. */
class RequestPathsTest {

    @Test
    void canonical_dropsPathParameters_decodes_appliesDotSegments_andIgnoresCaseAndTrailingSlashes() {
        String plain = "/novu-bridge/novu-adapter/v1/tenants/acme/_provision";
        for (String variant : new String[] {
                plain,
                "/novu-bridge/novu-adapter/v1;x/tenants/acme/_provision",
                "/novu-bridge;jsessionid=1/novu-adapter/v1/tenants;a=b/acme;/_provision;x",
                "/novu-bridge/novu-adapter/v1/%74enants/acme/_provisio%6E",
                "/novu-bridge/novu-adapter/V1/Tenants/ACME/_provision",
                "/novu-bridge/novu-adapter/v1/tenants/acme/_provision/",
                "/novu-bridge//novu-adapter/v1/./tenants/acme/_provision//",
                "/novu-bridge/novu-adapter/v1/zz/../tenants/acme/_provision",
                "/novu-bridge/novu-adapter/v1/zz/..;x/tenants/acme/_provision",
                "/novu-bridge/novu-adapter/v1/zz/%2e%2e/tenants/acme/_provision",
        }) {
            assertEquals(plain, RequestPaths.canonical(variant), variant);
        }
        assertEquals("/", RequestPaths.canonical(""));
        assertEquals("/", RequestPaths.canonical("/../.."));
        // An encoded ; is data, not a parameter: Spring MVC reads `v1;x` as one segment too.
        assertEquals("/novu-adapter/v1;x/tenants", RequestPaths.canonical("/novu-adapter/v1%3Bx/tenants"));
        // Not decodable: kept as sent.
        assertEquals("/a%zz", RequestPaths.canonical("/a%zz"));
    }

    @Test
    void inNamespace_readsTheSameWithOrWithoutTheContext_andOnlyOnASegmentBoundary() {
        assertEquals("/novu-adapter/v1/tenants", RequestPaths.inNamespace(request("/novu-bridge/novu-adapter/v1;x/tenants")));
        assertEquals("/novu-adapter/v1/tenants", RequestPaths.inNamespace(request("/novu-adapter/v1/tenants/")));
        assertEquals("/novu-adapter/v1", RequestPaths.inNamespace(request("/novu-bridge/novu-adapter/v1")));
        assertEquals("", RequestPaths.inNamespace(request("/novu-bridge/novu-adapter/v10/tenants")));
        assertEquals("", RequestPaths.inNamespace(request("/novu-bridge/health")));
        MockHttpServletRequest noUri = new MockHttpServletRequest();
        noUri.setRequestURI("");
        noUri.setServletPath("/novu-adapter/v1/messages/_send");
        assertEquals("/novu-adapter/v1/messages/_send", RequestPaths.inNamespace(noUri));
    }

    @Test
    void isAtOrUnder_isOnASegmentBoundary() {
        assertEquals(true, RequestPaths.isAtOrUnder("/novu-adapter/v1/tenants", "/novu-adapter/v1/tenants"));
        assertEquals(true, RequestPaths.isAtOrUnder("/novu-adapter/v1/tenants/acme", "/novu-adapter/v1/tenants"));
        assertEquals(false, RequestPaths.isAtOrUnder("/novu-adapter/v1/tenantsx", "/novu-adapter/v1/tenants"));
    }

    @Test
    void rejection_namesEverythingAPlainPathNeverContains() {
        for (String bad : new String[] {
                "/novu-adapter/v1;x/tenants", "/novu-adapter/v1/tenants;", "/novu-adapter/v1%3Bx/tenants",
                "/novu-adapter/v1%3bx/tenants", "/novu-adapter/v1%2Ftenants", "/novu-adapter/v1%2ftenants",
                "/novu-adapter/v1%5Ctenants", "/novu-adapter/v1\\tenants", "/novu-adapter/v1/%2e/tenants",
                "/novu-adapter/v1/%2E%2E/tenants", "/novu-adapter/v1/%252e/tenants", "/novu-adapter//v1/tenants",
                "/novu-adapter/v1/./tenants", "/novu-adapter/v1/../tenants", "/novu-adapter/v1/tenants/.",
                "/novu-adapter/v1/tenants/..", "/novu-adapter/v1/ten%00ants", "/novu-adapter/v1/ten%0Aants",
                "/novu-adapter/v1/ten\tants", "/novu-adapter/v1/ten%7Fants",
        }) {
            assertNotNull(RequestPaths.rejection(bad), bad);
        }
        for (String good : new String[] {
                "/novu-bridge/novu-adapter/v1/tenants/ke.bomet", "/novu-bridge/novu-adapter/v1/tenants/acme/_provision",
                "/novu-bridge/health", "/novu-bridge/novu-adapter/v1/%74enants", "/novu-bridge/novu-adapter/v1/logs",
                "/", "",
        }) {
            assertNull(RequestPaths.rejection(good), good);
        }
    }

    private static MockHttpServletRequest request(String uri) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRequestURI(uri);
        return req;
    }
}
