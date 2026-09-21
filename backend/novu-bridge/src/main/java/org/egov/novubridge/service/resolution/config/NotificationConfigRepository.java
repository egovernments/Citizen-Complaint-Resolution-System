package org.egov.novubridge.service.resolution.config;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;

import java.util.List;

/**
 * Where the four masters come from, for one tenant.
 *
 * <p><b>Why one interface and not four repositories</b>, which is what the design's package sketch
 * suggested. The choice of namespace is a <i>cross-master, per-tenant, all-or-nothing</i> decision:
 * a tenant whose {@code NOTIFICATIONS.Routing} is still empty is served its legacy
 * {@code RAINMAKER-PGR.Notification*} rows for <b>every</b> master, and the template conversion
 * needs the routing rows as context to get the audience join right. Four independent repositories
 * could each make that choice differently — which is exactly the per-row precedence between two
 * namespaces that nobody can reason about at 2am. One interface makes the decision once and makes
 * it reportable ({@link #describe}).
 *
 * <p>A non-DIGIT product implements this once and inherits routing, rendering, fan-out, dedupe,
 * gating and the ledger unchanged.
 */
public interface NotificationConfigRepository {

    List<RoutingRow> routing(String tenantId);

    List<TemplateRow> templates(String tenantId);

    List<ProviderTemplateRow> providerTemplates(String tenantId);

    /**
     * The event catalogue.
     *
     * <p>An <b>empty list means "this tenant has no catalogue"</b>, which is a real state, not a
     * failure: a server upgraded to this image before the seeder's copy step has run has legacy
     * routing rows and no catalogue at all. The resolution stage therefore enforces catalogue
     * membership only when the list is non-empty. Refusing every event on an un-copied tenant
     * would make the day-one upgrade impossible, which is a constraint, not a preference.
     */
    List<CatalogueRow> catalogue(String tenantId);

    /** Which namespace served each master for this tenant, and how many rows it found. */
    ConfigSourceReport describe(String tenantId);
}
