package org.egov.pgr.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * #2281 review: the time-boxed RestTemplate copy used for the workflow assignee lookups, against a
 * real HTTP server.
 */
class ServiceRequestRepositoryTest {

    private static final byte[] BODY = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);

    private HttpServer server;
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/fast", exchange -> respond(exchange, 0));
        server.createContext("/slow", exchange -> respond(exchange, 1500));
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void timeBoxedCopyKeepsTheBodyForABodyReadingInterceptor() {
        // The tracer's shared template, with restTemplateDetailedLoggingEnabled: a buffering
        // factory plus a logging interceptor that reads the response body.
        RestTemplate shared = new RestTemplate(new BufferingClientHttpRequestFactory(new SimpleClientHttpRequestFactory()));
        shared.getInterceptors().add((request, body, execution) -> {
            ClientHttpResponse response = execution.execute(request, body);
            StreamUtils.copyToByteArray(response.getBody());
            return response;
        });
        ServiceRequestRepository repository = new ServiceRequestRepository(new ObjectMapper(), shared, 2000, 5000);

        assertEquals(Map.of("ok", true), repository.fetchResult(new StringBuilder(baseUrl + "/fast"), Map.of()));
        assertEquals(Map.of("ok", true), repository.fetchResultWithTimeout(new StringBuilder(baseUrl + "/fast"), Map.of()),
                "the time-boxed copy lost the body to the interceptor");
    }

    @Test
    void timeBoxedCallFailsOnAHungServerInsteadOfWaiting() {
        // The shared template has no read timeout and would wait the 1.5 s out and return the body.
        ServiceRequestRepository repository = new ServiceRequestRepository(new ObjectMapper(), new RestTemplate(), 2000, 200);

        assertNull(repository.fetchResultWithTimeout(new StringBuilder(baseUrl + "/slow"), Map.of()));
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, long delayMs) throws java.io.IOException {
        try {
            exchange.getRequestBody().readAllBytes();
            if (delayMs > 0)
                Thread.sleep(delayMs);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, BODY.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(BODY);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (java.io.IOException ignored) {
            // the client gave up (read timeout)
        } finally {
            exchange.close();
        }
    }
}
