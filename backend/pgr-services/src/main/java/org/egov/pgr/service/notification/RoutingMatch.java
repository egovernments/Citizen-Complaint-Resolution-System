package org.egov.pgr.service.notification;

/**
 * One matched NotificationRouting row in the flattened model: a single (audience, channel)
 * pair for a (businessService, action, toState) transition. audience is any role code
 * (CITIZEN = the filer, EMPLOYEE = legacy alias for the single assignee, any other = the role
 * POOL); channel is SMS, WHATSAPP or EMAIL. There is exactly one RoutingMatch per matching MDMS row.
 *
 * assigneeOnly (default false) is a per-row opt-in: when true and a named assignee exists, a role
 * audience collapses the pool down to just that assignee instead of fanning out to everyone holding
 * the role.
 */
public class RoutingMatch {

    private final String audience;
    private final String channel;
    private final boolean assigneeOnly;

    public RoutingMatch(String audience, String channel) {
        this(audience, channel, false);
    }

    public RoutingMatch(String audience, String channel, boolean assigneeOnly) {
        this.audience = audience;
        this.channel = channel;
        this.assigneeOnly = assigneeOnly;
    }

    public String getAudience() {
        return audience;
    }

    public String getChannel() {
        return channel;
    }

    public boolean isAssigneeOnly() {
        return assigneeOnly;
    }
}
