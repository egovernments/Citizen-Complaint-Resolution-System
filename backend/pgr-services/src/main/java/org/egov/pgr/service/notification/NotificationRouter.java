package org.egov.pgr.service.notification;

import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.egov.pgr.util.PGRConstants.AUDIENCE_AUTO_ESCALATE;
import static org.egov.pgr.util.PGRConstants.AUDIENCE_SYSTEM;
import static org.egov.pgr.util.PGRConstants.CHANNEL_EMAIL;
import static org.egov.pgr.util.PGRConstants.CHANNEL_SMS;
import static org.egov.pgr.util.PGRConstants.CHANNEL_WHATSAPP;

/**
 * The "who"/"how": resolves the flattened RAINMAKER-PGR.NotificationRouting rows for a workflow
 * transition into the (audience, channel, assigneeOnly) tuples that should be notified. Each MDMS
 * row is one row per (audience, channel); this returns one RoutingMatch per matching row. Replaces
 * the hardcoded NOTIFICATION_ENABLE_FOR_STATUS gate + the per-transition if-chains.
 *
 * audience is now any role string (CITIZEN, EMPLOYEE alias, or a role pool like PGR_LME/GRO/...).
 * The router no longer validates the audience against a fixed enum — recipient resolution and pool
 * fan-out happen downstream in NotificationService. The router only drops the two non-notifiable
 * pseudo-audiences (AUTO_ESCALATE, SYSTEM) and still validates channel.
 *
 * Matching is on (businessService, action, toState). fromState is documentation-only and optional:
 * a row with a null fromState matches any source state (the Kafka consumer path doesn't carry
 * fromState — risk R1), and a non-null row fromState only filters when the request supplies one.
 */
@Slf4j
@Component
public class NotificationRouter {

    private static final Set<String> VALID_CHANNELS = new HashSet<>(Arrays.asList(
            CHANNEL_SMS, CHANNEL_WHATSAPP, CHANNEL_EMAIL));

    // Non-notifiable pseudo-audiences: workflow-internal, resolve to no recipients. Dropped here.
    private static final Set<String> NON_NOTIFIABLE_AUDIENCES = new HashSet<>(Arrays.asList(
            AUDIENCE_AUTO_ESCALATE, AUDIENCE_SYSTEM));

    private final MDMSUtils mdmsUtils;

    @Autowired
    public NotificationRouter(MDMSUtils mdmsUtils) {
        this.mdmsUtils = mdmsUtils;
    }

    @SuppressWarnings("unchecked")
    public List<RoutingMatch> route(String tenantId, String businessService, String fromState,
                                    String action, String toState) {
        List<RoutingMatch> matches = new ArrayList<>();
        if (!StringUtils.hasText(action) || !StringUtils.hasText(toState)) {
            return matches;
        }
        for (Object rowObj : mdmsUtils.getNotificationRouting(tenantId)) {
            if (!(rowObj instanceof Map)) continue;
            Map<String, Object> row = (Map<String, Object>) rowObj;

            if (Boolean.FALSE.equals(row.get("active"))) continue;
            if (!equalsIgnore(businessService, row.get("businessService"))) continue;
            if (!equalsIgnore(action, row.get("action"))) continue;
            if (!equalsIgnore(toState, row.get("toState"))) continue;

            Object rowFrom = row.get("fromState");
            if (rowFrom != null && !rowFrom.toString().isBlank() && !StringUtils.hasText(fromState)) {
                log.warn("NotificationRouting row {}.{}.{} authors fromState='{}' but the runtime path does not "
                        + "supply fromState — the row matches EVERY transition into toState. Clear fromState "
                        + "or wait for fromState support.", businessService, action, toState, rowFrom);
            }
            // fromState optional: match when the row leaves it blank OR it equals the request's.
            if (rowFrom != null && StringUtils.hasText(fromState)
                    && !fromState.equalsIgnoreCase(rowFrom.toString())) continue;

            String audience = normalize(row.get("audience"));
            String channel = normalize(row.get("channel"));
            if (audience == null) {
                log.warn("Ignoring NotificationRouting row with blank audience for action={} toState={}",
                        action, toState);
                continue;
            }
            // Non-notifiable pseudo-audiences resolve to no recipients — drop with a warning.
            if (NON_NOTIFIABLE_AUDIENCES.contains(audience)) {
                log.warn("Dropping non-notifiable NotificationRouting row audience='{}' for action={} "
                        + "toState={} (resolves to no recipients)", audience, action, toState);
                continue;
            }
            if (!VALID_CHANNELS.contains(channel)) {
                log.warn("Ignoring NotificationRouting row with unknown channel '{}' for action={} "
                        + "toState={} (must be one of {})", row.get("channel"), action, toState, VALID_CHANNELS);
                continue;
            }

            boolean assigneeOnly = Boolean.TRUE.equals(row.get("assigneeOnly"));
            matches.add(new RoutingMatch(audience, channel, assigneeOnly));
        }
        return matches;
    }

    private String normalize(Object value) {
        if (value == null) return null;
        String s = value.toString().trim();
        return s.isEmpty() ? null : s.toUpperCase();
    }

    private boolean equalsIgnore(String expected, Object actual) {
        return actual != null && expected != null && expected.equalsIgnoreCase(actual.toString());
    }
}
