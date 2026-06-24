package org.egov.novubridge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * On-the-wire contract test for the NotificationChannel lookup. Runs the REAL ConfigServiceClient
 * (real RestTemplate, real JSON, real HTTP) against a local stub that mimics digit-config-service's
 * _search contract — verifying the request shape the bridge emits and its response parsing /
 * legacy-fallback semantics, which the RestTemplate-mocked unit tests can't see.
 *
 * Contract mirrored from config-service models:
 *   _search request  : { RequestInfo, criteria:{ schemaCode, tenantId } }   (all records, no enabled filter)
 *   _search response : { configData:[ { data:{ code, enabled } }, ... ] }
 */
public class ConfigServiceClientContractTest {

    private static final String SEARCH_PATH = "/config-service/config/v1/_search";

    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private ConfigServiceClient client;

    private final AtomicReference<String> searchBody = new AtomicReference<>();
    private final AtomicReference<String> searchResponse = new AtomicReference<>("{\"configData\":[]}");
    private final AtomicInteger searchStatus = new AtomicInteger(200);

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(SEARCH_PATH, exchange -> {
            searchBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = searchResponse.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(searchStatus.get(), out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();

        int port = server.getAddress().getPort();
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setConfigHost("http://127.0.0.1:" + port);
        config.setConfigSearchPath(SEARCH_PATH);
        client = new ConfigServiceClient(new RestTemplate(), config);
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    @Test
    void getEnabledChannels_sendsSearchContract_andParsesEnabledLowercased() throws Exception {
        searchResponse.set("{\"ResponseInfo\":{},\"configData\":["
                + "{\"data\":{\"code\":\"WHATSAPP\",\"enabled\":true}},"
                + "{\"data\":{\"code\":\"EMAIL\",\"enabled\":true}},"
                + "{\"data\":{\"code\":\"SMS\",\"enabled\":false}}]}");

        List<String> channels = client.getEnabledChannels("pb.amritsar");

        assertEquals(List.of("whatsapp", "email"), channels);
        // Verify the _search request matches config-service's ConfigDataSearchRequest contract,
        // fetching ALL records (no enabled filter) so the caller can detect "unconfigured".
        JsonNode req = mapper.readTree(searchBody.get());
        assertTrue(req.has("RequestInfo"));
        JsonNode criteria = req.get("criteria");
        assertEquals("NotificationChannel", criteria.get("schemaCode").asText());
        assertEquals("pb.amritsar", criteria.get("tenantId").asText());
        assertFalse(criteria.has("criteria"));
    }

    @Test
    void getEnabledChannels_noRecords_returnsNullForLegacyFallback() {
        searchResponse.set("{\"configData\":[]}");
        assertNull(client.getEnabledChannels("pb.amritsar"));
    }

    @Test
    void getEnabledChannels_configuredButAllDisabled_returnsEmptyList() {
        searchResponse.set("{\"configData\":[{\"data\":{\"code\":\"WHATSAPP\",\"enabled\":false}}]}");
        assertTrue(client.getEnabledChannels("pb.amritsar").isEmpty());
    }

    @Test
    void getEnabledChannels_serverError_throwsForRetry() {
        // A real 5xx from config-service must propagate (retry/DLQ), not be read as "unconfigured".
        searchStatus.set(500);
        searchResponse.set("{\"error\":\"boom\"}");
        assertThrows(CustomException.class, () -> client.getEnabledChannels("pb.amritsar"));
    }
}
