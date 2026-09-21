package org.egov.novubridge.service.resolution;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * An audience, after scheme parsing: {@code "ROLE:GRO"} becomes {@code ("ROLE", "GRO")}.
 *
 * <p>A routing row's {@code audience} column is a <b>reference with a scheme</b>, not a role code.
 * That is what lets routing config own the audiences while the producer owns only the actors it
 * alone knows:
 *
 * <table>
 *   <caption>The schemes</caption>
 *   <tr><th>Form</th><th>Resolved by</th></tr>
 *   <tr><td>{@code ACTOR:<name>}</td><td>the event's {@code actors} map — no I/O</td></tr>
 *   <tr><td>{@code ROLE:<code>}</td><td>every holder of the role in the tenant</td></tr>
 *   <tr><td>{@code EVENT_RECIPIENTS}</td><td>the event's {@code recipients[]} array</td></tr>
 *   <tr><td>{@code A|B}</td><td>the first link that yields a non-empty list</td></tr>
 * </table>
 *
 * <p><b>The legacy bare names keep working</b>, which is what lets a live server's routing rows
 * survive an image upgrade that happens before the seeder's copy step has run. The mapping is
 * exactly the one {@code local-setup/scripts/notifications_convert.py} applies offline, so a row
 * read through the legacy adapter and the same row after the copy resolve identically:
 *
 * <table>
 *   <caption>Legacy bare audiences</caption>
 *   <tr><th>Legacy</th><th>Reads as</th></tr>
 *   <tr><td>{@code CITIZEN}</td><td>{@code ACTOR:citizen}</td></tr>
 *   <tr><td>{@code EMPLOYEE}</td><td>{@code ACTOR:assignee}</td></tr>
 *   <tr><td>{@code AUTO_ESCALATE}, {@code SYSTEM}</td><td>{@link #NON_NOTIFIABLE} — the row is dropped</td></tr>
 *   <tr><td>anything else</td><td>{@code ROLE:<it>}</td></tr>
 * </table>
 *
 * <p>{@code assigneeOnly} has no equivalent here because it does not survive the move: the row
 * that carried it becomes the chain {@code ACTOR:assignee|ROLE:<code>}, which is exactly what
 * "notify the named assignee, but fall through to the whole pool rather than notifying no one"
 * always meant.
 *
 * <p><b>An unknown scheme is never guessed at.</b> {@code SOMETHING:x} parses to the scheme
 * {@code SOMETHING}, finds no resolver, and produces a {@code SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME}
 * row. Falling back to "treat it as a role" would silently notify nobody and look like a config
 * that works.
 */
public final class AudienceRef {

    /** The event's {@code actors} map. Resolved in-process; no I/O. */
    public static final String ACTOR = "ACTOR";

    /** Every holder of a role in the tenant. The one scheme a non-DIGIT product must supply. */
    public static final String ROLE = "ROLE";

    /** The event's {@code recipients[]} array, for flows whose recipient has no account. */
    public static final String EVENT_RECIPIENTS = "EVENT_RECIPIENTS";

    /**
     * A pseudo-audience that deliberately resolves to nobody: {@code AUTO_ESCALATE},
     * {@code SYSTEM}. Not an error and not an unknown scheme — a row addressed to one of these
     * is dropped with a warning, exactly as {@code NotificationRouter} drops it today.
     */
    public static final String NON_NOTIFIABLE = "NON_NOTIFIABLE";

    private static final String ACTOR_CITIZEN = "citizen";
    private static final String ACTOR_ASSIGNEE = "assignee";

    private final String scheme;
    private final String value;
    private final String raw;

    public AudienceRef(String scheme, String value, String raw) {
        this.scheme = scheme;
        this.value = value;
        this.raw = raw;
    }

    public String scheme() {
        return scheme;
    }

    public String value() {
        return value;
    }

    /** The link exactly as the routing row spelled it — what an operator sees in a diagnostic. */
    public String raw() {
        return raw;
    }

    /**
     * Parse one audience column into its chain of links, in order.
     *
     * @return never null; empty only when the audience itself is blank
     */
    public static List<AudienceRef> parseChain(String audience) {
        if (audience == null || audience.trim().isEmpty()) {
            return Collections.emptyList();
        }
        List<AudienceRef> refs = new ArrayList<>();
        for (String part : audience.split("\\|")) {
            String link = part.trim();
            if (link.isEmpty()) {
                continue;
            }
            refs.add(parseLink(link));
        }
        return Collections.unmodifiableList(refs);
    }

    /** True when every link of the chain is a deliberate nobody — the row is dropped. */
    public static boolean isEntirelyNonNotifiable(List<AudienceRef> chain) {
        if (chain.isEmpty()) {
            return false;
        }
        for (AudienceRef ref : chain) {
            if (!NON_NOTIFIABLE.equals(ref.scheme)) {
                return false;
            }
        }
        return true;
    }

    private static AudienceRef parseLink(String link) {
        int colon = link.indexOf(':');
        if (colon > 0) {
            String scheme = link.substring(0, colon).trim().toUpperCase(Locale.ROOT);
            String value = link.substring(colon + 1).trim();
            return new AudienceRef(scheme, value, link);
        }
        String upper = link.toUpperCase(Locale.ROOT);
        if (EVENT_RECIPIENTS.equals(upper)) {
            return new AudienceRef(EVENT_RECIPIENTS, "", link);
        }
        // Legacy bare names. The table above, and notifications_convert.py's BARE_ACTORS /
        // NON_NOTIFIABLE, are the same mapping written twice on purpose: the Python one converts
        // the data once, this one reads a row the conversion has not reached yet.
        if ("CITIZEN".equals(upper)) {
            return new AudienceRef(ACTOR, ACTOR_CITIZEN, link);
        }
        if ("EMPLOYEE".equals(upper)) {
            return new AudienceRef(ACTOR, ACTOR_ASSIGNEE, link);
        }
        if ("AUTO_ESCALATE".equals(upper) || "SYSTEM".equals(upper)) {
            return new AudienceRef(NON_NOTIFIABLE, upper, link);
        }
        return new AudienceRef(ROLE, link, link);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof AudienceRef)) {
            return false;
        }
        AudienceRef other = (AudienceRef) o;
        return Objects.equals(scheme, other.scheme) && Objects.equals(value, other.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(scheme, value);
    }

    @Override
    public String toString() {
        return EVENT_RECIPIENTS.equals(scheme) ? scheme : scheme + ":" + value;
    }
}
