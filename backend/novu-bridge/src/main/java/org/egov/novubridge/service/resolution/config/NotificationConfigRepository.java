package org.egov.novubridge.service.resolution.config;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;

import java.util.List;

/**
 * SPI: where the four masters come from, for one tenant. They are loaded together so the
 * namespace choice (new vs legacy) is made once per event and applies to every master.
 */
public interface NotificationConfigRepository {

    /**
     * One event's config. An empty catalogue means "this tenant has no catalogue" (an upgrade
     * before the seeder's copy ran), so membership is not enforced.
     *
     * @throws RuntimeException when a master cannot be read and there is no cached copy. Never
     *         answer empty for a failure: empty is recorded as NB_NO_ROUTING and never retried.
     */
    NotificationConfig load(String tenantId);

    ConfigSourceReport describe(String tenantId);

    record NotificationConfig(List<RoutingRow> routing, List<TemplateRow> templates,
                              List<ProviderTemplateRow> providerTemplates, List<CatalogueRow> catalogue) {
    }
}
