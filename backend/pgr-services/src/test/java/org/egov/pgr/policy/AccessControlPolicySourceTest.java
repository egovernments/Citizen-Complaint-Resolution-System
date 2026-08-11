package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class AccessControlPolicySourceTest {

    private static final URI ENDPOINT = URI.create("http://access-control:8090/access/v1/actions/mdms/_get");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private RestTemplate restTemplate;
    private MockRestServiceServer server;
    private AccessControlPolicySource source;

    @BeforeEach
    void setUp() {
        restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        source = new AccessControlPolicySource(restTemplate, objectMapper, ENDPOINT, "actions-test");
    }

    @Test
    void postsExactRoleScopedPayloadAndPreservesTheMatchingDocument() {
        server.expect(once(), requestTo(ENDPOINT))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(content().json("""
                        {
                          "roleCodes": ["CITIZEN", "GRO"],
                          "tenantId": "pg.citya",
                          "actionMaster": "actions-test"
                        }
                        """, true))
                .andExpect(jsonPath("$.enabled").doesNotExist())
                .andExpect(jsonPath("$.RequestInfo").doesNotExist())
                .andRespond(withSuccess("""
                        {
                          "responseInfo": {"status": "OK"},
                          "actions": [
                            {"id": 1, "url": "/other", "method": "POST", "condition": true},
                            {"id": 2, "url": "/pgr-services/v2/request/_search"},
                            {"id": 3, "url": "/pgr-services/v2/request/_search", "method": "GET"},
                            {
                              "id": 2008,
                              "enabled": false,
                              "url": "/pgr-services/v2/request/_search",
                              "method": "POST",
                              "resource": {"complaint": {"attributes": ["citizen.mobileNumber"]}},
                              "condition": {"and": [{"==": [{"var": "user.tenantId"}, "pg.citya"]}, true]}
                            }
                          ]
                        }
                        """, MediaType.APPLICATION_JSON));

        List<PolicyAction> result = source.findActions(
                "pg.citya", "POST", "/pgr-services/v2/request/_search", List.of("CITIZEN", "GRO"));

        assertEquals(1, result.size());
        PolicyAction action = result.get(0);
        assertEquals("POST", action.method());
        assertEquals("/pgr-services/v2/request/_search", action.url());
        assertEquals(2008, action.document().get("id"));
        assertEquals(false, action.document().get("enabled"));
        assertEquals("citizen.mobileNumber", nestedAttribute(action.document()));
        assertTrue(action.condition() instanceof Map);
        assertThrows(UnsupportedOperationException.class,
                () -> ((List<Object>) nestedComplaint(action.document()).get("attributes")).add("citizen.name"));
        server.verify();
    }

    @Test
    void returnsEveryExactMatchSoTheRegistryCanRejectAmbiguousPolicies() {
        server.expect(requestTo(ENDPOINT)).andRespond(withSuccess("""
                {"actions": [
                  {"id": 1, "url": "/search", "method": "POST"},
                  {"id": 2, "url": "/search", "method": "POST"}
                ]}
                """, MediaType.APPLICATION_JSON));

        List<PolicyAction> result = source.findActions("pg", "POST", "/search", List.of("CITIZEN"));

        assertEquals(2, result.size());
        server.verify();
    }

    @Test
    void aValidEmptyActionListIsACleanAuthorizationDenial() {
        server.expect(requestTo(ENDPOINT))
                .andRespond(withSuccess("{\"actions\":[]}", MediaType.APPLICATION_JSON));

        List<PolicyAction> result =
                source.findActions("pg", "POST", "/search", List.of("CITIZEN"));

        assertTrue(result.isEmpty());
        server.verify();
    }

    @Test
    void rejectsMalformedResponseShapesInsteadOfTreatingThemAsNoPolicy() throws Exception {
        List<String> malformed = List.of(
                "null",
                "{}",
                "{\"actions\":{}}",
                "{\"actions\":[false]}",
                "{\"actions\":[{\"method\":\"POST\"}]}",
                "{\"actions\":[{\"url\":\"/search\",\"method\":false}]}",
                "{\"actions\":[{\"url\":\"/search\",\"method\":\" POST\"}]}",
                "{\"actions\":[{\"url\":\"/search\",\"method\":\"post\"}]}"
        );

        for (String json : malformed) {
            JsonNode response = objectMapper.readTree(json);
            assertThrows(MalformedPolicySourceResponseException.class,
                    () -> source.parseActions(response, "POST", "/search"), json);
        }
    }

    @Test
    void classifiesSyntacticallyInvalidSuccessfulBodiesAsMalformedPolicy() {
        server.expect(requestTo(ENDPOINT))
                .andRespond(withSuccess("{\"actions\": [", MediaType.APPLICATION_JSON));

        assertThrows(MalformedPolicySourceResponseException.class,
                () -> source.findActions("pg", "POST", "/search", List.of("CITIZEN")));
        server.verify();
    }

    @Test
    void rejectsDuplicateJsonKeysWithoutChangingTheSharedObjectMapper() throws Exception {
        String duplicateKeys = """
                {"actions": [{"id": 2008, "url": "/search", "url": "/other", "method": "POST"}]}
                """;

        assertThrows(MalformedPolicySourceResponseException.class,
                () -> source.parseResponse(duplicateKeys, "POST", "/search"));
        JsonNode parsedBySharedMapper = objectMapper.readTree(duplicateKeys);
        assertEquals("/other", parsedBySharedMapper.get("actions").get(0).get("url").textValue());
    }

    @Test
    void ignoresLegacyRowsBeforeValidatingTheirDefaultUrls() throws Exception {
        JsonNode response = objectMapper.readTree("""
                {"actions": [
                  {"id": 1, "url": ""},
                  {"id": 2},
                  {"id": 2008, "enabled": false, "url": "/search", "method": "POST"}
                ]}
                """);

        List<PolicyAction> result = source.parseActions(response, "POST", "/search");

        assertEquals(1, result.size());
        assertEquals(2008, result.get(0).document().get("id"));
        assertEquals(false, result.get(0).document().get("enabled"));
    }

    @Test
    void ignoresMalformedPolicyMetadataForAnUnrelatedUrl() throws Exception {
        JsonNode response = objectMapper.readTree("""
                {"actions": [
                  {"id": 1, "url": "/unrelated", "method": false},
                  {"id": 2, "url": "/also-unrelated", "method": "post"},
                  {"id": 2008, "url": "/search", "method": "POST", "condition": true}
                ]}
                """);

        List<PolicyAction> result = source.parseActions(response, "POST", "/search");

        assertEquals(1, result.size());
        assertEquals(2008, result.get(0).document().get("id"));
    }

    @Test
    void propagatesHttpFailures() {
        server.expect(requestTo(ENDPOINT))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\":\"unavailable\"}"));

        assertThrows(HttpServerErrorException.ServiceUnavailable.class,
                () -> source.findActions("pg", "POST", "/search", List.of("CITIZEN")));
        server.verify();
    }

    @Test
    void rejectsNonCanonicalRoleListsWithoutRewritingTheCacheIdentity() {
        assertThrows(IllegalArgumentException.class,
                () -> source.findActions("pg", "POST", "/search", List.of("GRO", "CITIZEN")));
        assertThrows(IllegalArgumentException.class,
                () -> source.findActions("pg", "POST", "/search", List.of("CITIZEN", "CITIZEN")));
    }

    @Test
    void buildsADedicatedClientWithTheConfiguredTimeouts() {
        PGRConfiguration config = new PGRConfiguration();
        config.setAccessControlHost("http://access-control:8090/");
        config.setAccessControlActionsMdmsGetPath("/access/v1/actions/mdms/_get");
        config.setAccessControlActionsMaster("actions-test");
        config.setAccessControlConnectTimeoutMillis(1234L);
        config.setAccessControlReadTimeoutMillis(5678L);
        RestTemplateBuilder builder = new RestTemplateBuilder()
                .requestFactory(SimpleClientHttpRequestFactory::new);

        AccessControlPolicySource configuredSource =
                new AccessControlPolicySource(builder, objectMapper, config);

        RestTemplate configuredClient = (RestTemplate) ReflectionTestUtils.getField(configuredSource, "restTemplate");
        SimpleClientHttpRequestFactory requestFactory =
                (SimpleClientHttpRequestFactory) configuredClient.getRequestFactory();
        assertEquals(1234, ReflectionTestUtils.getField(requestFactory, "connectTimeout"));
        assertEquals(5678, ReflectionTestUtils.getField(requestFactory, "readTimeout"));
        assertEquals(URI.create("http://access-control:8090/access/v1/actions/mdms/_get"),
                ReflectionTestUtils.getField(configuredSource, "endpoint"));
        assertTrue(AccessControlPolicySource.class.isAnnotationPresent(Lazy.class));
    }

    @SuppressWarnings("unchecked")
    private String nestedAttribute(Map<String, Object> document) {
        return (String) ((List<Object>) nestedComplaint(document).get("attributes")).get(0);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> nestedComplaint(Map<String, Object> document) {
        Map<String, Object> resource = (Map<String, Object>) document.get("resource");
        return (Map<String, Object>) resource.get("complaint");
    }
}
