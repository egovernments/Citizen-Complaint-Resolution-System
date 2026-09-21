package org.egov.novubridge.web.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.client.RestTemplate;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The contract endpoints serve the SAME bytes the build packages, and they are reachable
 * without a token — the two things that make "fetch the contract from the running service"
 * a real answer rather than a slogan.
 */
class ContractControllerTest {

    private final ContractController controller = new ContractController();

    @Test
    @DisplayName("GET /contract/envelope returns the packaged JSON Schema as JSON")
    void envelopeServesThePackagedSchema() throws Exception {
        ResponseEntity<String> response = controller.envelope();

        assertEquals(200, response.getStatusCode().value());
        assertEquals(MediaType.APPLICATION_JSON, response.getHeaders().getContentType());
        Map<?, ?> parsed = new ObjectMapper().readValue(response.getBody(), Map.class);
        assertEquals("https://json-schema.org/draft/2020-12/schema", parsed.get("$schema"));
        assertNotNull(parsed.get("properties"), "the served schema must describe the envelope");
    }

    @Test
    @DisplayName("GET /contract/openapi returns the packaged spec as YAML")
    void openapiServesThePackagedSpec() {
        ResponseEntity<String> response = controller.openapi();

        assertEquals(200, response.getStatusCode().value());
        assertEquals("application/yaml", String.valueOf(response.getHeaders().getContentType()));
        Map<?, ?> parsed = new Yaml().loadAs(response.getBody(), Map.class);
        assertTrue(String.valueOf(parsed.get("openapi")).startsWith("3."));
        assertNotNull(parsed.get("paths"));
    }

    @Test
    @DisplayName("the contract paths are outside the auth gate — no token, no introspection, no refusal")
    void contractPathsAreNotGated() throws Exception {
        RestTemplate restTemplate = mock(RestTemplate.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setProxyAuthEnabled(true);
        config.setProxyAllowedRoles(List.of("EMPLOYEE"));
        config.setProxyAdminRoles(List.of("SUPERUSER"));
        ProxyAuthFilter filter = new ProxyAuthFilter(restTemplate, config);

        for (String path : List.of("/novu-adapter/v1/contract/envelope", "/novu-adapter/v1/contract/openapi")) {
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setMethod("GET");
            request.setServletPath(path);
            request.setRequestURI("/novu-bridge" + path);
            MockHttpServletResponse response = new MockHttpServletResponse();
            MockFilterChain chain = new MockFilterChain();

            filter.doFilter(request, response, chain);

            assertNotNull(chain.getRequest(), path + " was blocked by the auth filter");
            assertEquals(200, response.getStatus(), path + " was refused");
        }
        // No bearer token was sent and none was demanded: egov-user is never asked.
        verifyNoInteractions(restTemplate);
    }
}
