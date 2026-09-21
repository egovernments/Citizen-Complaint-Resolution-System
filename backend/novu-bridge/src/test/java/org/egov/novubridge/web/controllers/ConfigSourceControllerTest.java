package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@code GET /novu-adapter/v1/config/source} — the answer to "which namespace is this tenant on",
 * which exists precisely because there is no setting to read.
 */
class ConfigSourceControllerTest {

    private final NotificationConfigRepository repository = mock(NotificationConfigRepository.class);
    private final ConfigSourceController controller = new ConfigSourceController(repository);

    @Test
    @DisplayName("it reports the schema code, the row count and the legacy flag, per master")
    void itReportsEachMaster() {
        ConfigSourceReport report = new ConfigSourceReport("ke.bomet", "ke")
                .with(new ConfigSourceReport.MasterSource("Routing",
                        "RAINMAKER-PGR.NotificationRouting", 41, true, false))
                .with(new ConfigSourceReport.MasterSource("EventCatalogue",
                        "NOTIFICATIONS.EventCatalogue", 0, false, false));
        when(repository.describe(eq("ke.bomet"))).thenReturn(report);

        ResponseEntity<ConfigSourceReport> response = controller.source("ke.bomet");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        ConfigSourceReport body = response.getBody();
        assertEquals("ke", body.getStateTenantId());
        assertEquals(41, body.getMasters().get("Routing").getRows(),
                "the row COUNT is what an operator compares before trusting the new namespace");
        assertTrue(body.getMasters().get("Routing").isLegacy());
        assertTrue(body.isAnyLegacy(), "one legacy master is enough to say the copy has not finished");
    }

    @Test
    @DisplayName("a fully copied tenant says so, with no legacy master anywhere")
    void aCopiedTenantReportsTheNewNamespace() {
        ConfigSourceReport report = new ConfigSourceReport("ke.bomet", "ke")
                .with(new ConfigSourceReport.MasterSource("Routing", "NOTIFICATIONS.Routing", 41, false, false));
        when(repository.describe(eq("ke.bomet"))).thenReturn(report);

        assertTrue(!controller.source("ke.bomet").getBody().isAnyLegacy());
    }

    @Test
    @DisplayName("a stale master is flagged, so 'it is serving config' is not mistaken for 'MDMS is up'")
    void staleIsVisible() {
        ConfigSourceReport report = new ConfigSourceReport("ke.bomet", "ke")
                .with(new ConfigSourceReport.MasterSource("Routing", "NOTIFICATIONS.Routing", 41, false, true));
        when(repository.describe(eq("ke.bomet"))).thenReturn(report);

        assertTrue(controller.source("ke.bomet").getBody().getMasters().get("Routing").isStale());
    }

    @Test
    @DisplayName("a tenant with nothing anywhere reports zeroes rather than an error")
    void anUnseededTenantIsNotAFailure() {
        when(repository.describe(eq("ke.nowhere")))
                .thenReturn(new ConfigSourceReport("ke.nowhere", "ke"));
        ConfigSourceReport body = controller.source("ke.nowhere").getBody();
        assertEquals(Collections.emptyMap(), body.getMasters());
        assertTrue(!body.isAnyLegacy(),
                "no rows is not the same as legacy rows, and the screen must not say it is");
        assertEquals(List.of(), List.copyOf(body.getMasters().keySet()));
    }
}
