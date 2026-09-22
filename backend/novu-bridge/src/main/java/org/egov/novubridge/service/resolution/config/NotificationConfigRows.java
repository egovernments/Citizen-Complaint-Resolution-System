package org.egov.novubridge.service.resolution.config;

import java.util.List;
import java.util.Locale;

/**
 * The four config masters as the resolution stage sees them, with no MDMS vocabulary. Field names
 * match {@code NOTIFICATIONS.json}; the legacy adapter presents old rows in this same shape.
 */
public final class NotificationConfigRows {

    private NotificationConfigRows() {
    }

    /** {@code NOTIFICATIONS.Routing}: x-unique {@code (eventName, audience, channel)}. */
    public record RoutingRow(String module, String eventName, String audience, String channel, boolean active) {
    }

    /** {@code NOTIFICATIONS.Template}: x-unique {@code (eventName, audience, channel, locale)}. */
    public record TemplateRow(String module, String eventName, String audience, String channel,
                              String locale, String subject, String body, boolean active) {

        /** The MDMS uniqueIdentifier; recorded as the ledger's {@code template_key}. */
        public String uid() {
            return String.join(".", eventName, audience, channel, locale);
        }
    }

    /** {@code NOTIFICATIONS.ProviderTemplate}: x-unique {@code (provider, channel, eventName, audience, locale)}. */
    public record ProviderTemplateRow(String provider, String channel, String eventName, String audience,
                                      String locale, String templateId, List<String> variables,
                                      String approvalStatus, boolean active) {

        public ProviderTemplateRow {
            variables = variables == null ? List.of() : List.copyOf(variables);
        }

        /** Approved AND active AND carrying a template id. */
        public boolean usable() {
            return active
                    && approvalStatus != null
                    && "approved".equals(approvalStatus.trim().toLowerCase(Locale.ROOT))
                    && templateId != null && !templateId.trim().isEmpty();
        }
    }

    /** {@code NOTIFICATIONS.EventCatalogue}: only membership is enforced at runtime. */
    public record CatalogueRow(String eventName, boolean active) {
    }
}
