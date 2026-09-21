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
 * Which namespace is serving a tenant's notification config, and how many rows it found.
 *
 * <p><b>This exists because there is no setting to read.</b> The choice between the new
 * {@code NOTIFICATIONS.*} masters and the legacy {@code RAINMAKER-PGR.Notification*} ones is made
 * by the data — a tenant with zero rows in the new namespace is served the old one, per tenant and
 * all-or-nothing — precisely so that no compose overlay can flip it. The cost of that is that two
 * tenants on the same build can legitimately be served differently, and an operator needs a way to
 * see which. This is that way.
 *
 * <p>Read-only and tenant-scoped: it reports row counts and schema codes, never row content, so it
 * sits on the broad read allowlist alongside the Logs screen rather than the admin tier.
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
