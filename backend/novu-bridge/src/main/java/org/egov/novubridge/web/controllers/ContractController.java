package org.egov.novubridge.web.controllers;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * The published contract, served by the service that implements it. Two read-only documents:
 * the JSON Schema of the inbound Kafka envelope and the OpenAPI description of every
 * {@code /novu-adapter/v1} endpoint. Both are the byte-identical copies packaged in this jar
 * under {@code contract/}, so what a consumer fetches is what this build actually enforces —
 * never a wiki page that drifted.
 *
 * <p><b>Why these two are unauthenticated.</b> They are descriptions of an interface: no tenant
 * data, no recipient, no credential, nothing about any deployment. The existing auth model
 * already works this way — {@link org.egov.novubridge.web.filters.ProxyAuthFilter} gates an
 * explicit list of namespaces (logs, integrations, preferences, providers, dispatch) and lets
 * everything else through, which is how the actuator endpoints and the machine callbacks are
 * reached. {@code /novu-adapter/v1/contract/**} is deliberately outside that list. It adds no
 * new auth concept and no new exception: a caller learns the shape of the API, which the
 * published docs state anyway.
 *
 * <p>GET only. There is no write path here and no per-tenant variation — the contract is a
 * property of the build, not of the deployment.
 */
@RestController
@RequestMapping("/novu-adapter/v1/contract")
public class ContractController {

    static final String ENVELOPE_SCHEMA = "contract/envelope-v1.schema.json";
    static final String OPENAPI = "contract/openapi.yaml";

    /** JSON Schema (2020-12) of the inbound Kafka envelope, schema version 1. */
    @GetMapping(value = "/envelope", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> envelope() {
        return serve(ENVELOPE_SCHEMA, MediaType.APPLICATION_JSON);
    }

    /** OpenAPI 3.0 description of every /novu-adapter/v1 endpoint this build exposes. */
    @GetMapping(value = "/openapi", produces = "application/yaml")
    public ResponseEntity<String> openapi() {
        return serve(OPENAPI, MediaType.parseMediaType("application/yaml"));
    }

    /**
     * Read a packaged document. A missing resource answers 404 rather than 500: it can only
     * mean the jar was built without the contract, which is a packaging fault to be seen, not
     * an error to be attributed to the caller's request.
     */
    private static ResponseEntity<String> serve(String resource, MediaType type) {
        ClassPathResource classPathResource = new ClassPathResource(resource);
        if (!classPathResource.exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"Errors\":[{\"code\":\"NB_CONTRACT_NOT_PACKAGED\",\"message\":\""
                            + resource + " is not on the classpath of this build\"}]}");
        }
        try (InputStream in = classPathResource.getInputStream()) {
            return ResponseEntity.ok()
                    .contentType(type)
                    .body(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"Errors\":[{\"code\":\"NB_CONTRACT_UNREADABLE\",\"message\":\""
                            + resource + " could not be read\"}]}");
        }
    }
}
