package org.egov.novubridge.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * On-the-wire contract test for the NotificationChannel calls. Runs the REAL ConfigServiceClient
 * (real RestTemplate, real JSON serialization, real HTTP) against a local stub that mimics
 * digit-config-service's _resolve / _search contract. Catches request-shape / parsing drift that
 * the RestTemplate-mocked unit tests can't see.
 *
 * Contract mirrored from config-service models:
 *   _resolve request : { RequestInfo, resolveRequest:{ schemaCode, tenantId, criteria } }
 *   _resolve response: { configData:{ ..., data:{...} } }
 *   _search request  : { RequestInfo, criteria:{ schemaCode, tenantId, criteria } }
 *   _search response : { configData:[ { data:{...} }, ... ] }
 */
public class ConfigServiceClientContractTest {

    private static final String RESOLVE_PATH = "/config-service/config/v1/_resolve";
    private static final String SEARCH_PATH = "/config-service/config/v1/_search";

    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private ConfigServiceClient client;

    private final AtomicReference<String> resolveBody = new AtomicReference<>();
    private final AtomicReference<String> searchBody = new AtomicReference<>();
    private final AtomicReference<String> resolveResponse = new AtomicReference<>("{\"configData\":null}");
    private final AtomicReference<String> searchResponse = new AtomicReference<>("{\"configData\":[]}");

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(RESOLVE_PATH, exchange -> {
            resolveBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = resolveResponse.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.createContext(SEARCH_PATH, exchange -> {
            searchBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = searchResponse.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();

        int port = server.getAddress().getPort();
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setConfigHost("http://127.0.0.1:" + port);
        config.setConfigResolvePath(RESOLVE_PATH);
        config.setConfigSearchPath(SEARCH_PATH);
        client = new ConfigServiceClient(new RestTemplate(), config);
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    @Test
    void isChannelEnabled_sendsResolveContract_andParsesEnabled() throws Exception {
        resolveResponse.set("{\"ResponseInfo\":{},\"configData\":{\"tenantId\":\"pb.amritsar\","
                + "\"schemaCode\":\"NotificationChannel\",\"data\":{\"code\":\"WHATSAPP\",\"name\":\"WhatsApp\",\"enabled\":true}}}");

        boolean enabled = client.isChannelEnabled("pb.amritsar", "whatsapp");

        assertTrue(enabled);
        // Verify the exact request the bridge put on the wire matches config-service's _resolve contract.
        JsonNode req = mapper.readTree(resolveBody.get());
        assertTrue(req.has("RequestInfo"));
        JsonNode rr = req.get("resolveRequest");
        assertEquals("NotificationChannel", rr.get("schemaCode").asText());
        assertEquals("pb.amritsar", rr.get("tenantId").asText());
        assertEquals("WHATSAPP", rr.get("criteria").get("code").asText()); // lowercased channel -> uppercase code
    }

    @Test
    void isChannelEnabled_disabledRecord_parsesFalse() {
        resolveResponse.set("{\"configData\":{\"data\":{\"code\":\"WHATSAPP\",\"enabled\":false}}}");
        assertFalse(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void isChannelEnabled_noRecord_defaultsOff() {
        resolveResponse.set("{\"configData\":null}");
        assertFalse(client.isChannelEnabled("pb.amritsar", "whatsapp"));
    }

    @Test
    void getEnabledChannels_sendsSearchContract_andParsesLowercasedCodes() throws Exception {
        searchResponse.set("{\"configData\":["
                + "{\"data\":{\"code\":\"WHATSAPP\",\"enabled\":true}},"
                + "{\"data\":{\"code\":\"EMAIL\",\"enabled\":true}},"
                + "{\"data\":{\"code\":\"SMS\",\"enabled\":false}}]}");

        List<String> channels = client.getEnabledChannels("pb.amritsar");

        assertEquals(List.of("whatsapp", "email"), channels);
        // Verify the _search request matches config-service's ConfigDataSearchRequest contract.
        JsonNode req = mapper.readTree(searchBody.get());
        assertTrue(req.has("RequestInfo"));
        JsonNode criteria = req.get("criteria");
        assertEquals("NotificationChannel", criteria.get("schemaCode").asText());
        assertEquals("pb.amritsar", criteria.get("tenantId").asText());
        assertTrue(criteria.get("criteria").get("enabled").asBoolean());
    }

    @Test
    void getEnabledChannels_noRecords_returnsEmpty() {
        searchResponse.set("{\"configData\":[]}");
        assertTrue(client.getEnabledChannels("pb.amritsar").isEmpty());
    }
}
