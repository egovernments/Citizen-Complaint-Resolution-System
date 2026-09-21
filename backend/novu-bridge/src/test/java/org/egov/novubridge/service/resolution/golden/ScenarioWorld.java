package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.LocaleProvider;
import org.egov.novubridge.service.resolution.LocalizationProvider;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.service.resolution.digit.DigitUserSearch;
import org.egov.novubridge.service.resolution.digit.LegacyMasterAdapter;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One golden scenario's "outside world", as in-memory SPI implementations.
 *
 * <p>Everything the resolution stage would reach over the network — egov-user, egov-localization,
 * the preference service, MDMS — is served from the scenario's {@code world} block here, and the
 * classes under test are the REAL ones: the real {@link LegacyMasterAdapter} converts the real
 * legacy seed rows, the real {@code DigitRoleRecipientResolver} pages the real
 * {@link DigitUserSearch} contract, the real {@code DigitUserHydrator} hydrates. Only the
 * transport is faked, and it is faked at the narrowest seam each adapter has.
 *
 * <p>That is deliberate. A parity test that stubbed the resolvers themselves would prove the
 * resolver loop and nothing about the two behaviours most likely to regress in a port: role-pool
 * paging with uuid-less holders, and the legacy audience join.
 */
final class ScenarioWorld {

    private final JsonNode world;

    ScenarioWorld(JsonNode world) {
        this.world = world;
    }

    // ---- localization ------------------------------------------------------

    /**
     * Serves {@code world.localization[module].messages[]}. Note it ignores the requested locale,
     * exactly as the fixture's own generator does: the scenarios express a locale by REPLACING a
     * module's message list (S13 swaps rainmaker-pgr for its Hindi strings), which is how a real
     * localization service behaves from one caller's point of view.
     */
    LocalizationProvider localization() {
        boolean fails = world.path("localizationFails").asBoolean(false);
        JsonNode messages = world.path("localization");
        return (tenantId, locale, modules, code, requestInfo) -> {
            if (fails) {
                throw new IllegalStateException("localization is down in this scenario");
            }
            for (String module : modules) {
                for (JsonNode message : messages.path(module).path("messages")) {
                    if (code.equals(message.path("code").asText())) {
                        return message.path("message").asText();
                    }
                }
            }
            return null;
        };
    }

    // ---- preferences -------------------------------------------------------

    LocaleProvider locales() {
        Map<String, String> byUuid = new HashMap<>();
        world.path("preferences").fields()
                .forEachRemaining(e -> byUuid.put(e.getKey(), e.getValue().asText()));
        return (tenantId, requestInfo) -> byUuid;
    }

    // ---- egov-user ---------------------------------------------------------

    /**
     * The narrowest possible fake: it answers the ONE method the two DIGIT adapters make an HTTP
     * call in, so their paging loop, their dedupe, their uuid-less handling and their
     * country-code prefixing all run for real.
     */
    DigitUserSearch userSearch(NovuBridgeConfiguration config) {
        JsonNode rolePools = world.path("rolePools");
        JsonNode usersByUuid = world.path("usersByUuid");
        return new DigitUserSearch(null, config) {
            @Override
            public boolean available() {
                return true;
            }

            @Override
            public List<Map<String, Object>> search(Map<String, Object> criteria, String tenantId,
                                                    RequestInfo requestInfo) {
                Object uuids = criteria.get("uuid");
                if (uuids instanceof List && !((List<?>) uuids).isEmpty()) {
                    JsonNode user = usersByUuid.path(String.valueOf(((List<?>) uuids).get(0)));
                    return user.isMissingNode() || user.isNull()
                            ? Collections.emptyList()
                            : List.of(toMap(user));
                }
                Object roleCodes = criteria.get("roleCodes");
                if (roleCodes instanceof List && !((List<?>) roleCodes).isEmpty()) {
                    String role = String.valueOf(((List<?>) roleCodes).get(0));
                    int page = ((Number) criteria.get("pageNumber")).intValue();
                    JsonNode pages = rolePools.path(role);
                    if (!pages.isArray() || page >= pages.size()) {
                        return Collections.emptyList();
                    }
                    List<Map<String, Object>> rows = new ArrayList<>();
                    pages.get(page).forEach(row -> rows.add(toMap(row)));
                    return rows;
                }
                return Collections.emptyList();
            }
        };
    }

    // ---- MDMS --------------------------------------------------------------

    /**
     * The four masters, built by running the scenario's LEGACY seed rows through the real
     * {@link LegacyMasterAdapter} — which is the path a server that has not yet run the seeder's
     * copy step takes, and therefore the one the golden master actually describes.
     *
     * @param catalogue the committed {@code NOTIFICATIONS.EventCatalogue} rows; a tenant on the
     *                  legacy masters would have none, but feeding the real ones proves the
     *                  catalogue shipped for PGR covers every event PGR emits
     */
    NotificationConfigRepository config(List<Map<String, Object>> routingRows,
                                        List<Map<String, Object>> templateRows,
                                        List<Map<String, Object>> providerTemplateRows,
                                        List<CatalogueRow> catalogue) {
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(routingRows);
        // A row the adapter cannot convert is DROPPED, exactly as the Python converter drops it
        // and reports it: one unconvertible row (a blank audience, say) must not take a whole
        // tenant's notifications down with it. S17 is the scenario that exercises this.
        List<RoutingRow> routing = new ArrayList<>();
        for (Map<String, Object> row : routingRows) {
            try {
                RoutingRow converted = LegacyMasterAdapter.convertRouting(row);
                if (converted != null) {
                    routing.add(converted);
                }
            } catch (LegacyMasterAdapter.ConversionException ignored) {
                // dropped, with the reason available to the converter's own report
            }
        }
        List<TemplateRow> templates = new ArrayList<>();
        for (Map<String, Object> row : templateRows) {
            try {
                TemplateRow converted = LegacyMasterAdapter.convertTemplate(row, index);
                if (converted != null) {
                    templates.add(converted);
                }
            } catch (LegacyMasterAdapter.ConversionException ignored) {
                // dropped
            }
        }
        List<ProviderTemplateRow> providerTemplates = new ArrayList<>();
        for (Map<String, Object> row : providerTemplateRows) {
            try {
                ProviderTemplateRow converted = LegacyMasterAdapter.convertProviderTemplate(row, index);
                if (converted != null) {
                    providerTemplates.add(converted);
                }
            } catch (LegacyMasterAdapter.ConversionException ignored) {
                // dropped
            }
        }
        return new NotificationConfigRepository() {
            @Override
            public List<RoutingRow> routing(String tenantId) {
                return routing;
            }

            @Override
            public List<TemplateRow> templates(String tenantId) {
                return templates;
            }

            @Override
            public List<ProviderTemplateRow> providerTemplates(String tenantId) {
                return providerTemplates;
            }

            @Override
            public List<CatalogueRow> catalogue(String tenantId) {
                return catalogue;
            }

            @Override
            public ConfigSourceReport describe(String tenantId) {
                return new ConfigSourceReport(tenantId, "ke");
            }
        };
    }

    // ---- the world's other answers -----------------------------------------

    String shortUrl() {
        return world.path("shortUrlFails").asBoolean(false) ? "" : world.path("shortUrl").asText(null);
    }

    JsonNode hrms() {
        return world.path("hrms");
    }

    JsonNode mdms() {
        return world.path("mdms");
    }

    JsonNode workflowHistory() {
        return world.path("workflowHistory");
    }

    JsonNode usersByUuid() {
        return world.path("usersByUuid");
    }

    static Map<String, Object> toMap(JsonNode node) {
        Map<String, Object> out = new LinkedHashMap<>();
        node.fields().forEachRemaining(e -> out.put(e.getKey(), value(e.getValue())));
        return out;
    }

    private static Object value(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isInt() || node.isLong()) {
            return node.asLong();
        }
        if (node.isArray()) {
            List<Object> out = new ArrayList<>();
            node.forEach(element -> out.add(value(element)));
            return out;
        }
        if (node.isObject()) {
            return toMap((ObjectNode) node);
        }
        return node.asText();
    }
}
