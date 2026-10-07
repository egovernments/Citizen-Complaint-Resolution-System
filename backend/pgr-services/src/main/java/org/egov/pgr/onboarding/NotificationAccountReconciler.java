package org.egov.pgr.onboarding;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Retries the notification accounts the NOTIFICATION_ACCOUNT step DEFERRED (#2203): a workspace
 * created while Novu or novu-bridge was down is created without its own messaging, and this gives
 * it an account once they answer. The onboarding runner calls {@link #reconcileDue()} on its own
 * thread; it does work at most once per interval. novu-bridge's provision is idempotent, so a
 * retry can never create a second organization.
 *
 * <p>Only workspaces whose signup ran this step are considered: tenants onboarded before #2203,
 * and legacy tenants, are moved onto their own account only by an operator's explicit backfill
 * ({@code POST /novu-adapter/v1/tenants/_backfill}), because moving them changes which provider
 * credentials their messages use.
 */
@Slf4j
@Component
public class NotificationAccountReconciler {

    private static final int BATCH = 100;

    private final JdbcTemplate jdbc;
    private final NotificationAccountClient client;
    private final long intervalMs;
    private volatile long nextRunAt;
    LongSupplier clock = System::currentTimeMillis;

    public NotificationAccountReconciler(JdbcTemplate jdbc, NotificationAccountClient client,
                                         @Value("${pgr.onboarding.notification-account.reconcile-interval-ms:600000}") long intervalMs) {
        this.jdbc = jdbc;
        this.client = client;
        this.intervalMs = Math.max(10_000L, intervalMs);
    }

    /** Runs {@link #reconcile()} when its interval has passed; never throws. */
    public void reconcileDue() {
        long now = clock.getAsLong();
        if (!client.configured() || now < nextRunAt) {
            return;
        }
        nextRunAt = now + intervalMs;
        try {
            reconcile();
        } catch (RuntimeException e) {
            log.warn("Notification account reconcile failed: {}", e.getMessage());
        }
    }

    /** @return how many deferred workspaces are now provisioned */
    int reconcile() {
        List<String> deferred = jdbc.queryForList("SELECT s.requested_tenant_id FROM eg_pgr_onboarding_operation o "
                + "JOIN eg_pgr_onboarding_signup s ON s.id = o.signup_id "
                + "WHERE o.status = 'SUCCEEDED' AND s.status = 'ACTIVE' AND o.record_progress->>? = ? "
                + "ORDER BY o.updated_at LIMIT " + BATCH, String.class,
                OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS, OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED);
        if (deferred.isEmpty()) {
            return 0;
        }
        Map<String, String> outcomes = client.backfill(deferred);
        int provisioned = 0;
        for (Map.Entry<String, String> outcome : outcomes.entrySet()) {
            if (!"PROVISIONED".equals(outcome.getValue())) {
                continue;
            }
            // Only a finished operation, still marked DEFERRED: never races a running saga.
            provisioned += jdbc.update("UPDATE eg_pgr_onboarding_operation o SET record_progress = "
                    + "jsonb_set(o.record_progress, ARRAY[?], to_jsonb(?::text)) FROM eg_pgr_onboarding_signup s "
                    + "WHERE s.id = o.signup_id AND s.requested_tenant_id = ? AND o.status = 'SUCCEEDED' "
                    + "AND o.record_progress->>? = ?",
                    OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS, OnboardingSteps.NOTIFICATION_ACCOUNT_DONE,
                    outcome.getKey(), OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS,
                    OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED) > 0 ? 1 : 0;
        }
        log.info("Notification account reconcile: {} deferred workspace(s), {} provisioned now ({})",
                deferred.size(), provisioned, outcomes);
        return provisioned;
    }
}
