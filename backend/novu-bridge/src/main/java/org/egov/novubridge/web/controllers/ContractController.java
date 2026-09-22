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
 * The published contract (envelope and thin-event JSON Schemas, OpenAPI), served from the copies
 * packaged in this jar so a consumer fetches what this build enforces. Unauthenticated on purpose:
 * they describe the interface and carry no tenant data, recipient or credential.
 */
@RestController
@RequestMapping("/novu-adapter/v1/contract")
public class ContractController {

    static final String ENVELOPE_SCHEMA = "contract/envelope-v1.schema.json";
    static final String THIN_EVENT_SCHEMA = "contract/thin-event-v1.schema.json";
    static final String OPENAPI = "contract/openapi.yaml";

    /** JSON Schema (2020-12) of the inbound Kafka envelope, schema version 1. */
    @GetMapping(value = "/envelope", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> envelope() {
        return serve(ENVELOPE_SCHEMA, MediaType.APPLICATION_JSON);
    }

    /** JSON Schema (2020-12) of the thin domain event ({@code kind: "THIN"}), schema version 1. */
    @GetMapping(value = "/thin-event", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> thinEvent() {
        return serve(THIN_EVENT_SCHEMA, MediaType.APPLICATION_JSON);
    }

    /** OpenAPI 3.0 description of every /novu-adapter/v1 endpoint this build exposes. */
    @GetMapping(value = "/openapi", produces = "application/yaml")
    public ResponseEntity<String> openapi() {
        return serve(OPENAPI, MediaType.parseMediaType("application/yaml"));
    }

    /** A missing resource is a packaging fault, not the caller's: 404, not 500. */
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
