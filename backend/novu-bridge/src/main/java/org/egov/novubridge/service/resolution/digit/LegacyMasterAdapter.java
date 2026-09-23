package org.egov.novubridge.service.resolution.digit;

import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Presents a legacy {@code RAINMAKER-PGR.Notification*} row in the {@code NOTIFICATIONS.*} shape.
 * Pure: no I/O, no state. Every function is idempotent (an already-converted row passes through).
 *
 * <p>The mapping MUST stay identical to {@code local-setup/scripts/notifications_convert.py}, or a
 * tenant's messages change the moment the seeder's copy runs:
 * <pre>
 *   businessService + action + toState  ->  eventName "COMPLAINTS.WORKFLOW.&lt;ACTION&gt;.&lt;TOSTATE&gt;"
 *   audience (bare) + assigneeOnly      ->  audience reference with a scheme
 *   fromState, businessService, assigneeOnly -> dropped;  module -> "Complaints"
 * </pre>
 *
 * <p>Join hazard: routing {@code audience=GRO, assigneeOnly=true} becomes
 * {@code ACTOR:assignee|ROLE:GRO}, but its template row has no assigneeOnly column and would map
 * to {@code ROLE:GRO}, silently breaking the template lookup. So templates reuse the audience
 * string routing produced ({@link #buildAudienceIndex}).
 */
public final class LegacyMasterAdapter {

    /** Locale a row with a blank locale falls back to; locale is a required key in the new schema. */
    public static final String DEFAULT_LOCALE = "en_IN";

    private static final Set<String> NON_NOTIFIABLE = Set.of("AUTO_ESCALATE", "SYSTEM");
    private static final Map<String, String> BARE_ACTORS =
            Map.of("CITIZEN", "ACTOR:citizen", "EMPLOYEE", "ACTOR:assignee");

    /** An unknown businessService is converted under a derived prefix, never dropped. */
    private static final Map<String, String[]> BUSINESS_SERVICE_MODULES =
            Map.of("PGR", new String[]{"Complaints", "COMPLAINTS.WORKFLOW"});

    private LegacyMasterAdapter() {
    }

    /** A row that cannot be converted without inventing data. */
    public static final class ConversionException extends IllegalArgumentException {
        public ConversionException(String message) {
            super(message);
        }
    }

    public static String moduleFor(Object businessService) {
        String bs = text(businessService).isEmpty() ? "PGR" : text(businessService);
        String[] mapped = BUSINESS_SERVICE_MODULES.get(bs.toUpperCase(Locale.ROOT));
        return mapped != null ? mapped[0] : bs;
    }

    /** {@code COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME} from {@code (PGR, ASSIGN, PENDINGATLME)}. */
    public static String eventName(Object businessService, Object action, Object toState) {
        String act = text(action).toUpperCase(Locale.ROOT);
        String state = text(toState).toUpperCase(Locale.ROOT);
        if (act.isEmpty() || state.isEmpty()) {
            throw new ConversionException("cannot derive eventName: action='" + act + "' toState='" + state
                    + "' (both are required; the producer returns early on a blank action or toState)");
        }
        String bs = text(businessService).isEmpty() ? "PGR" : text(businessService);
        String[] mapped = BUSINESS_SERVICE_MODULES.get(bs.toUpperCase(Locale.ROOT));
        String prefix = mapped != null ? mapped[1] : bs.toUpperCase(Locale.ROOT) + ".WORKFLOW";
        return prefix + "." + act + "." + state;
    }

    /** True when the audience is already a scheme reference; left exactly as it is. */
    public static boolean isSchemeRef(Object audience) {
        String value = text(audience);
        if (value.isEmpty()) {
            return false;
        }
        for (String part : value.split("\\|")) {
            String link = part.trim();
            if (link.startsWith("ACTOR:") || link.startsWith("ROLE:") || "EVENT_RECIPIENTS".equals(link)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Legacy bare audience (+ {@code assigneeOnly}) to an audience reference with a scheme.
     *
     * @return null for a non-notifiable audience, which means: drop the row
     */
    public static String audienceRef(Object audience, Object assigneeOnly) {
        String value = text(audience);
        if (value.isEmpty()) {
            throw new ConversionException("audience is blank");
        }
        if (isSchemeRef(value)) {
            return value;
        }
        String upper = value.toUpperCase(Locale.ROOT);
        if (NON_NOTIFIABLE.contains(upper)) {
            return null;
        }
        String actor = BARE_ACTORS.get(upper);
        if (actor != null) {
            return actor;
        }
        // "Notify the named assignee, but fall through to the whole pool rather than notifying
        // no one" is exactly a pipe chain.
        return truthy(assigneeOnly) ? "ACTOR:assignee|ROLE:" + value : "ROLE:" + value;
    }

    /** The row's active flag: {@code active}, else {@code isActive}, else true. */
    public static boolean isActive(Map<String, Object> row) {
        if (row.containsKey("active")) {
            return truthy(row.get("active"));
        }
        if (row.containsKey("isActive")) {
            return truthy(row.get("isActive"));
        }
        return true;
    }

    /** @return the converted row, or null when the audience is not notifiable */
    public static RoutingRow convertRouting(Map<String, Object> row) {
        if (alreadyConverted(row)) {
            return new RoutingRow(text(row.get("module")), text(row.get("eventName")),
                    text(row.get("audience")), text(row.get("channel")).toUpperCase(Locale.ROOT),
                    isActive(row));
        }
        String audience = audienceRef(row.get("audience"), row.get("assigneeOnly"));
        if (audience == null) {
            return null;
        }
        return new RoutingRow(
                moduleFor(row.get("businessService")),
                eventName(row.get("businessService"), row.get("action"), row.get("toState")),
                audience,
                text(row.get("channel")).toUpperCase(Locale.ROOT),
                isActive(row));
    }

    /**
     * How routing mapped each legacy audience, so templates can reuse the same string.
     *
     * @return {@code (audience, action, toState, channel) -> ref} plus, where every channel agreed
     *         on one ref, the channel-independent {@code (audience, action, toState) -> ref}
     */
    public static Map<String, String> buildAudienceIndex(List<Map<String, Object>> routingRows) {
        Map<String, String> exact = new HashMap<>();
        Map<String, Set<String>> grouped = new LinkedHashMap<>();
        if (routingRows == null) {
            return exact;
        }
        for (Map<String, Object> row : routingRows) {
            if (alreadyConverted(row)) {
                continue;   // nothing legacy left to key on
            }
            String ref;
            try {
                ref = audienceRef(row.get("audience"), row.get("assigneeOnly"));
            } catch (ConversionException e) {
                continue;
            }
            if (ref == null) {
                continue;
            }
            String legacy = text(row.get("audience")).toUpperCase(Locale.ROOT);
            String action = text(row.get("action")).toUpperCase(Locale.ROOT);
            String toState = text(row.get("toState")).toUpperCase(Locale.ROOT);
            String channel = text(row.get("channel")).toUpperCase(Locale.ROOT);
            exact.put(key(legacy, action, toState, channel), ref);
            grouped.computeIfAbsent(key(legacy, action, toState), k -> new HashSet<>()).add(ref);
        }
        grouped.forEach((k, refs) -> {
            if (refs.size() == 1) {
                exact.put(k, refs.iterator().next());
            }
        });
        return exact;
    }

    public static TemplateRow convertTemplate(Map<String, Object> row, Map<String, String> audienceIndex) {
        if (alreadyConverted(row)) {
            return new TemplateRow(text(row.get("module")), text(row.get("eventName")),
                    text(row.get("audience")), text(row.get("channel")).toUpperCase(Locale.ROOT),
                    localeOf(row), string(row.get("subject")), row.get("body") == null ? "" : String.valueOf(row.get("body")),
                    isActive(row));
        }
        String audience = joinedAudience(row, audienceIndex);
        if (audience == null) {
            return null;
        }
        return new TemplateRow(
                moduleFor(row.get("businessService")),
                eventName(row.get("businessService"), row.get("action"), row.get("toState")),
                audience,
                text(row.get("channel")).toUpperCase(Locale.ROOT),
                localeOf(row),
                text(row.get("subject")).isEmpty() ? null : String.valueOf(row.get("subject")),
                row.get("body") == null ? "" : String.valueOf(row.get("body")),
                isActive(row));
    }

    public static ProviderTemplateRow convertProviderTemplate(Map<String, Object> row,
                                                              Map<String, String> audienceIndex) {
        if (alreadyConverted(row)) {
            return new ProviderTemplateRow(text(row.get("provider")),
                    text(row.get("channel")).toUpperCase(Locale.ROOT), text(row.get("eventName")),
                    text(row.get("audience")), localeOf(row), text(row.get("templateId")),
                    strings(row.get("variables")), string(row.get("approvalStatus")), isActive(row));
        }
        String audience = joinedAudience(row, audienceIndex);
        if (audience == null) {
            return null;
        }
        return new ProviderTemplateRow(
                text(row.get("provider")),
                text(row.get("channel")).toUpperCase(Locale.ROOT),
                eventName(row.get("businessService"), row.get("action"), row.get("toState")),
                audience,
                localeOf(row),
                text(row.get("templateId")),
                strings(row.get("variables")),
                text(row.get("approvalStatus")).isEmpty() ? null : String.valueOf(row.get("approvalStatus")),
                isActive(row));
    }

    /** The audience string the matching routing row produced, else the bare mapping. */
    private static String joinedAudience(Map<String, Object> row, Map<String, String> audienceIndex) {
        String legacy = text(row.get("audience")).toUpperCase(Locale.ROOT);
        String action = text(row.get("action")).toUpperCase(Locale.ROOT);
        String toState = text(row.get("toState")).toUpperCase(Locale.ROOT);
        String channel = text(row.get("channel")).toUpperCase(Locale.ROOT);
        if (audienceIndex != null && !audienceIndex.isEmpty()) {
            String qualified = audienceIndex.get(key(legacy, action, toState, channel));
            if (qualified != null) {
                return qualified;
            }
            String shared = audienceIndex.get(key(legacy, action, toState));
            if (shared != null) {
                return shared;
            }
        }
        return audienceRef(row.get("audience"), null);
    }

    /** Has an eventName and no action: already converted, so passed through unchanged. */
    private static boolean alreadyConverted(Map<String, Object> row) {
        return row.containsKey("eventName") && !row.containsKey("action");
    }

    private static String localeOf(Map<String, Object> row) {
        String locale = text(row.get("locale"));
        return locale.isEmpty() ? DEFAULT_LOCALE : locale;
    }

    private static String key(String... parts) {
        return String.join("\u0000", parts);
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean truthy(Object value) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value == null) {
            return false;
        }
        String s = text(value).toLowerCase(Locale.ROOT);
        return "true".equals(s) || "1".equals(s) || "yes".equals(s);
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<>();
        if (value instanceof List) {
            for (Object element : (List<Object>) value) {
                if (element != null) {
                    out.add(String.valueOf(element));
                }
            }
        }
        return out;
    }
}
