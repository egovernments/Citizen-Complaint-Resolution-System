package org.egov.novubridge.service.resolution;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * One link of a routing row's audience: {@code "ROLE:GRO"} is {@code ("ROLE", "GRO")}. A column
 * is a pipe chain ({@code ACTOR:assignee|ROLE:GRO}); the first link that yields anyone wins.
 *
 * <p>Legacy bare names still parse, so routing rows survive an upgrade that runs before the
 * seeder's copy: CITIZEN is ACTOR:citizen, EMPLOYEE is ACTOR:assignee, AUTO_ESCALATE/SYSTEM are
 * {@link #NON_NOTIFIABLE}, anything else is ROLE:it. This mapping must match
 * {@code local-setup/scripts/notifications_convert.py}. An unknown {@code SCHEME:x} is never
 * guessed at; it becomes NB_UNKNOWN_AUDIENCE_SCHEME.
 *
 * @param raw the link as the routing row spelled it, for diagnostics
 */
public record AudienceRef(String scheme, String value, String raw) {

    public static final String ACTOR = "ACTOR";
    public static final String ROLE = "ROLE";
    public static final String EVENT_RECIPIENTS = "EVENT_RECIPIENTS";

    /** A deliberate nobody ({@code AUTO_ESCALATE}, {@code SYSTEM}): the row is dropped, not an error. */
    public static final String NON_NOTIFIABLE = "NON_NOTIFIABLE";

    /** @return never null; empty only when the audience is blank */
    public static List<AudienceRef> parseChain(String audience) {
        if (audience == null || audience.trim().isEmpty()) {
            return Collections.emptyList();
        }
        List<AudienceRef> refs = new ArrayList<>();
        for (String part : audience.split("\\|")) {
            String link = part.trim();
            if (!link.isEmpty()) {
                refs.add(parseLink(link));
            }
        }
        return Collections.unmodifiableList(refs);
    }

    public static boolean isEntirelyNonNotifiable(List<AudienceRef> chain) {
        return !chain.isEmpty() && chain.stream().allMatch(ref -> NON_NOTIFIABLE.equals(ref.scheme));
    }

    private static AudienceRef parseLink(String link) {
        int colon = link.indexOf(':');
        if (colon > 0) {
            return new AudienceRef(link.substring(0, colon).trim().toUpperCase(Locale.ROOT),
                    link.substring(colon + 1).trim(), link);
        }
        String upper = link.toUpperCase(Locale.ROOT);
        switch (upper) {
            case EVENT_RECIPIENTS:
                return new AudienceRef(EVENT_RECIPIENTS, "", link);
            case "CITIZEN":
                return new AudienceRef(ACTOR, "citizen", link);
            case "EMPLOYEE":
                return new AudienceRef(ACTOR, "assignee", link);
            case "AUTO_ESCALATE":
            case "SYSTEM":
                return new AudienceRef(NON_NOTIFIABLE, upper, link);
            default:
                return new AudienceRef(ROLE, link, link);
        }
    }
}
