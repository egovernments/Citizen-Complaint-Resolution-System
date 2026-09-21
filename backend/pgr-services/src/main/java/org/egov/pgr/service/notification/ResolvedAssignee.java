package org.egov.pgr.service.notification;

/**
 * Who a complaint is currently with, as PGR resolved them — the live workflow assignee, else the
 * last {@code ASSIGN} in workflow history. Walking that history is PGR knowledge and stays in PGR;
 * novu-bridge is simply told the answer.
 *
 * <p>Two shapes, and the difference is load-bearing:
 *
 * <ul>
 *   <li><b>uuid-only</b> ({@code inline == false}) — the normal path. PGR's own egov-user lookup
 *       succeeded, so the bridge can hydrate name, phone and email itself and none of that contact
 *       detail goes on Kafka.</li>
 *   <li><b>inline</b> ({@code inline == true}) — the fallback. PGR's egov-user lookup FAILED and all
 *       anyone holds is the user record embedded in the workflow's history entry, so it is sent as
 *       is (no country code, possibly no uuid). Design errata 6: this publishes the same person
 *       under a different identity, and it is the only case where the producer ships contact
 *       details for an account-holding employee.</li>
 * </ul>
 *
 * <p>{@code name} is carried in both shapes because it also fills the {@code {emp_name}}
 * placeholder, which the producer owns (design errata 8: the assignee is resolved for
 * {@code {emp_name}} regardless of whether anyone is routed to them).
 */
public final class ResolvedAssignee {

    private final String userId;
    private final String name;
    private final String phone;
    private final boolean inline;

    private ResolvedAssignee(String userId, String name, String phone, boolean inline) {
        this.userId = userId;
        this.name = name;
        this.phone = phone;
        this.inline = inline;
    }

    /** The normal path: the bridge hydrates everything from the uuid. */
    public static ResolvedAssignee ofUuid(String userId, String name) {
        return new ResolvedAssignee(userId, name, null, false);
    }

    /** The fallback: egov-user could not be reached, so the workflow record travels on the wire. */
    public static ResolvedAssignee inline(String userId, String name, String phone) {
        return new ResolvedAssignee(userId, name, phone, true);
    }

    public String getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public String getPhone() {
        return phone;
    }

    public boolean isInline() {
        return inline;
    }
}
