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
 * Read-only list of the Novu integrations, through the {@link IntegrationProjection} allowlist:
 * no credentials and never the Novu ApiKey leave this service.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class IntegrationController {

    private final NovuClient novuClient;

    public IntegrationController(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    @GetMapping("/integrations")
    public ResponseEntity<IntegrationListResponse> integrations() {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        // Surface upstream failures instead of returning 200 with an empty list.
        if (novuResponse == null || novuResponse.getStatusCode() == null
                || novuResponse.getStatusCode() < 200 || novuResponse.getStatusCode() >= 300) {
            return new ResponseEntity<>(HttpStatus.BAD_GATEWAY);
        }
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());
        List<Map<String, Object>> projected = new ArrayList<>(integrations.size());
        for (Map<String, Object> integration : integrations) {
            projected.add(IntegrationProjection.projectListItem(integration));
        }
        IntegrationListResponse response = IntegrationListResponse.builder()
                .data(projected)
                .total((long) projected.size())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }
}
