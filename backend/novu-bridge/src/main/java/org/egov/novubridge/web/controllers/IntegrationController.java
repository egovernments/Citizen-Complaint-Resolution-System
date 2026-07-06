package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Read-only proxy exposing the configured Novu provider integrations to the
 * configurator's Notification Providers screen. Sits alongside
 * {@code DispatchController} under the same {@code /novu-adapter/v1} namespace.
 *
 * <p><b>Secrets stay server-side.</b> Novu is called here with the ApiKey held
 * by {@link NovuClient} (the keyless configurator SPA never sees that key). Rather
 * than denylisting known secret locations, the response is built by an ALLOWLIST
 * projection: for each integration only a fixed set of non-secret fields
 * ({@code _id}, {@code providerId}, {@code channel}, {@code name},
 * {@code identifier}, {@code active}, {@code primary}, {@code environmentId}) is
 * copied out. Nothing else — in particular no {@code credentials} key, masked or
 * otherwise — ever leaves this service, so a secret stored outside a
 * {@code credentials} object cannot leak. There is deliberately NO endpoint that
 * returns the raw Novu key or any provider secret.
 *
 * <p><b>Observability boundary:</b> this lists the Novu-side provider configuration
 * only. All delivery now goes through Novu; channels with no active Novu integration are gated
 * off via novu.bridge.channels.enabled and show up in the dispatch log as SKIPPED.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class IntegrationController {

    private final NovuClient novuClient;

    public IntegrationController(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    /**
     * Return the Novu integration list as an allowlist projection (no secrets).
     *
     * @return {@code {data:[integration...], total}} — read-only, non-secret fields only.
     */
    @GetMapping("/integrations")
    public ResponseEntity<IntegrationListResponse> integrations() {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());
        List<Map<String, Object>> projected = new ArrayList<>(integrations.size());
        for (Map<String, Object> integration : integrations) {
            projected.add(IntegrationProjection.project(integration));
        }
        IntegrationListResponse response = IntegrationListResponse.builder()
                .data(projected)
                .total((long) projected.size())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
