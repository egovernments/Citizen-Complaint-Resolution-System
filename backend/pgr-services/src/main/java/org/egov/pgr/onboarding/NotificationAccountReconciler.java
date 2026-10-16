package org.egov.pgr.onboarding;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
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
 * <p>Each run looks at up to {@link #batch} deferred workspaces, oldest first, and asks the bridge
 * about {@link #perCall} at a time: a fresh workspace costs the bridge about ten Novu calls, so one
 * call for the whole batch would outlast pgr's read timeout after an outage and fail them all. A
 * workspace that still fails moves to the back of the queue, so a few that fail for good never
 * keep the rest from being retried. A call the bridge never answers ends the run: the next one, an
 * interval later, picks up where it stopped.
 *
 * <p>Only workspaces whose signup ran this step are considered: tenants onboarded before #2203,
 * and legacy tenants, are moved onto their own account only by an operator's explicit backfill
 * ({@code POST /novu-adapter/v1/tenants/_backfill}), because moving them changes which provider
 * credentials their messages use.
 */
@Slf4j
@Component
public class NotificationAccountReconciler {

    /** Deferred workspaces looked at per run. */
    int batch = 100;
    /** Workspaces per {@code _backfill} call. */
    int perCall = 5;

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
                + "ORDER BY o.updated_at LIMIT " + batch, String.class,
                OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS, OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED);
        if (deferred.isEmpty()) {
            return 0;
        }
        int provisioned = 0;
        int asked = 0;
        Map<String, String> outcomes = new LinkedHashMap<>();
        for (int from = 0; from < deferred.size(); from += perCall) {
            List<String> call = deferred.subList(from, Math.min(from + perCall, deferred.size()));
            Map<String, String> answered = client.backfill(call);
            outcomes.putAll(answered);
            asked += call.size();
            for (String tenant : call) {
                if ("PROVISIONED".equals(answered.get(tenant))) {
                    provisioned += markDone(tenant);
                } else {
                    moveToTheBack(tenant);
                }
            }
            if (!answered.isEmpty() && answered.values().stream().allMatch(NotificationAccountClient.UNAVAILABLE::equals)) {
                // The bridge did not answer (down, or slower than the read timeout): asking it about
                // the rest now would only wait out the same timeout once per call.
                break;
            }
        }
        log.info("Notification account reconcile: {} deferred workspace(s), {} asked, {} provisioned now ({})",
                deferred.size(), asked, provisioned, outcomes);
        return provisioned;
    }

    /** Only a finished operation, still marked DEFERRED: never races a running saga. */
    private int markDone(String tenant) {
        return jdbc.update("UPDATE eg_pgr_onboarding_operation o SET record_progress = "
                + "jsonb_set(o.record_progress, ARRAY[?], to_jsonb(?::text)) FROM eg_pgr_onboarding_signup s "
                + "WHERE s.id = o.signup_id AND s.requested_tenant_id = ? AND o.status = 'SUCCEEDED' "
                + "AND o.record_progress->>? = ?",
                OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS, OnboardingSteps.NOTIFICATION_ACCOUNT_DONE,
                tenant, OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS,
                OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED) > 0 ? 1 : 0;
    }

    /** A workspace that still failed goes behind the others ({@code ORDER BY updated_at}). */
    private void moveToTheBack(String tenant) {
        jdbc.update("UPDATE eg_pgr_onboarding_operation o SET updated_at = ? FROM eg_pgr_onboarding_signup s "
                + "WHERE s.id = o.signup_id AND s.requested_tenant_id = ? AND o.status = 'SUCCEEDED' "
                + "AND o.record_progress->>? = ?",
                clock.getAsLong(), tenant, OnboardingSteps.NOTIFICATION_ACCOUNT_PROGRESS,
                OnboardingSteps.NOTIFICATION_ACCOUNT_DEFERRED);
    }
}
