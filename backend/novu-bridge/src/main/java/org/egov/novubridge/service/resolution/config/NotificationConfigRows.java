package org.egov.novubridge.service.resolution.config;

import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The four config masters, as the resolution stage sees them. Plain carriers: no MDMS vocabulary,
 * no {@code uniqueIdentifier}, no {@code isActive} wrapper — a product that keeps this config in a
 * database instead of MDMS implements {@link NotificationConfigRepository} and builds these.
 *
 * <p>Field names match {@code NOTIFICATIONS.json}'s properties exactly, because that is the shape
 * an operator authors and the Configurator edits. Legacy {@code RAINMAKER-PGR.Notification*} rows
 * are presented in this same shape by the legacy adapter, so nothing downstream of here knows
 * which namespace a tenant is on.
 */
public final class NotificationConfigRows {

    private NotificationConfigRows() {
    }

    /** {@code NOTIFICATIONS.Routing}: x-unique {@code (eventName, audience, channel)}. */
    public static final class RoutingRow {
        private final String module;
        private final String eventName;
        private final String audience;
        private final String channel;
        private final boolean active;

        public RoutingRow(String module, String eventName, String audience, String channel, boolean active) {
            this.module = module;
            this.eventName = eventName;
            this.audience = audience;
            this.channel = channel;
            this.active = active;
        }

        public String module() { return module; }
        public String eventName() { return eventName; }
        public String audience() { return audience; }
        public String channel() { return channel; }
        public boolean active() { return active; }

        @Override
        public String toString() {
            return eventName + " " + audience + " " + channel + (active ? "" : " (inactive)");
        }
    }

    /** {@code NOTIFICATIONS.Template}: x-unique {@code (eventName, audience, channel, locale)}. */
    public static final class TemplateRow {
        private final String module;
        private final String eventName;
        private final String audience;
        private final String channel;
        private final String locale;
        private final String subject;
        private final String body;
        private final boolean active;

        public TemplateRow(String module, String eventName, String audience, String channel,
                           String locale, String subject, String body, boolean active) {
            this.module = module;
            this.eventName = eventName;
            this.audience = audience;
            this.channel = channel;
            this.locale = locale;
            this.subject = subject;
            this.body = body;
            this.active = active;
        }

        public String module() { return module; }
        public String eventName() { return eventName; }
        public String audience() { return audience; }
        public String channel() { return channel; }
        public String locale() { return locale; }
        public String subject() { return subject; }
        public String body() { return body; }
        public boolean active() { return active; }

        /**
         * The MDMS {@code uniqueIdentifier} of this row — the x-unique values, in order, joined
         * with dots. It is what the ledger records as {@code template_key}, so an operator reading
         * a row can go straight to the master row that produced it.
         */
        public String uid() {
            return String.join(".", eventName, audience, channel, locale);
        }
    }

    /**
     * {@code NOTIFICATIONS.ProviderTemplate}: x-unique
     * {@code (provider, channel, eventName, audience, locale)}.
     */
    public static final class ProviderTemplateRow {
        private final String provider;
        private final String channel;
        private final String eventName;
        private final String audience;
        private final String locale;
        private final String templateId;
        private final List<String> variables;
        private final String approvalStatus;
        private final boolean active;

        public ProviderTemplateRow(String provider, String channel, String eventName, String audience,
                                   String locale, String templateId, List<String> variables,
                                   String approvalStatus, boolean active) {
            this.provider = provider;
            this.channel = channel;
            this.eventName = eventName;
            this.audience = audience;
            this.locale = locale;
            this.templateId = templateId;
            this.variables = variables == null ? Collections.emptyList() : List.copyOf(variables);
            this.approvalStatus = approvalStatus;
            this.active = active;
        }

        public String provider() { return provider; }
        public String channel() { return channel; }
        public String eventName() { return eventName; }
        public String audience() { return audience; }
        public String locale() { return locale; }
        public String templateId() { return templateId; }
        public List<String> variables() { return variables; }
        public String approvalStatus() { return approvalStatus; }
        public boolean active() { return active; }

        /** Approved AND active AND carrying a template id. Anything less is not sendable. */
        public boolean usable() {
            return active
                    && approvalStatus != null
                    && "approved".equals(approvalStatus.trim().toLowerCase(Locale.ROOT))
                    && templateId != null && !templateId.trim().isEmpty();
        }
    }

    /** {@code NOTIFICATIONS.EventCatalogue}: x-unique {@code (eventName)}. */
    public static final class CatalogueRow {
        private final String module;
        private final String eventName;
        private final String entityType;
        private final String label;
        private final List<Map<String, Object>> placeholders;
        private final boolean active;

        public CatalogueRow(String module, String eventName, String entityType, String label,
                            List<Map<String, Object>> placeholders, boolean active) {
            this.module = module;
            this.eventName = eventName;
            this.entityType = entityType;
            this.label = label;
            this.placeholders = placeholders == null ? Collections.emptyList() : List.copyOf(placeholders);
            this.active = active;
        }

        public String module() { return module; }
        public String eventName() { return eventName; }
        public String entityType() { return entityType; }
        public String label() { return label; }
        public List<Map<String, Object>> placeholders() { return placeholders; }
        public boolean active() { return active; }
    }
}
