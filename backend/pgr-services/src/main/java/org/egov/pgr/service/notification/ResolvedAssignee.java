package org.egov.pgr.service.notification;

/**
 * Who a complaint is currently with, as PGR resolved them — the live workflow assignee, else the
 * last {@code ASSIGN} in workflow history. Walking that history is PGR knowledge and stays in PGR;
 * novu-bridge is simply told the answer.
 *
 * <p>Two shapes, and the difference is load-bearing:
 *
 * <ul>
 *   <li><b>uuid-only</b> ({@code inline == false}) — whenever a uuid is known, including when
 *       PGR's own egov-user lookup failed: the bridge hydrates name, phone and email itself, so none
 *       of that contact detail goes on Kafka.</li>
 *   <li><b>inline</b> ({@code inline == true}) — the last resort: the workflow's history entry
 *       carries no uuid, so its embedded user record (no country code) is the only contact anyone
 *       has and is sent as is.</li>
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

    /** Any known uuid: the bridge hydrates the contact from it. */
    public static ResolvedAssignee ofUuid(String userId, String name) {
        return new ResolvedAssignee(userId, name, null, false);
    }

    /** No uuid to hydrate from, so the workflow record's contact travels on the wire. */
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
