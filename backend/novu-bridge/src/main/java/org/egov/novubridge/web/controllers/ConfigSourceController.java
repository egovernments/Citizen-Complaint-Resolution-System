package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Which namespace ({@code NOTIFICATIONS.*} or legacy {@code RAINMAKER-PGR.*}) serves a tenant's
 * notification config, with row counts. The data chooses per tenant (no setting can flip it), so
 * this is the only way to see it. Counts and schema codes only, never row content.
 */
@Controller
@RequestMapping("/novu-adapter/v1/config")
public class ConfigSourceController {

    private final NotificationConfigRepository repository;

    public ConfigSourceController(NotificationConfigRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/source")
    public ResponseEntity<ConfigSourceReport> source(@RequestParam("tenantId") String tenantId) {
        return new ResponseEntity<>(repository.describe(tenantId), HttpStatus.OK);
    }
}
