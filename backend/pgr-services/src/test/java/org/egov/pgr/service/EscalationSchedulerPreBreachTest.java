package org.egov.pgr.service;

import org.junit.jupiter.api.Test;

import static org.egov.pgr.service.EscalationScheduler.isInPreBreachWindow;
import static org.egov.pgr.service.EscalationScheduler.shouldEmitPreBreach;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit coverage for {@link EscalationScheduler#shouldEmitPreBreach} — the
 * stateless crossing-detection predicate behind the PRD pre-breach warning.
 * Emit exactly once: on the first scheduler tick at/after thresholdPercent of
 * the SLA, and never once the SLA itself has breached. Also covers
 * {@link EscalationScheduler#isInPreBreachWindow}, the crossing-free window
 * predicate dry runs use to count complaints currently at risk.
 */
public class EscalationSchedulerPreBreachTest {

    private static final long SLA_MS = 100_000L;
    private static final long INTERVAL_MS = 10_000L;

    /** Elapsed well under the threshold → silent. */
    @Test
    void belowThreshold_noWarning() {
        // threshold = 75% of 100s = 75s; elapsed 50s.
        assertFalse(shouldEmitPreBreach(50_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /** First tick at/after the threshold crossing → emit. */
    @Test
    void firstTickAfterCrossing_emits() {
        // elapsed 80s, previous tick was at 70s (< 75s threshold) → crossed now.
        assertTrue(shouldEmitPreBreach(80_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /** Second tick after the crossing → already warned, stay silent. */
    @Test
    void secondTickAfterCrossing_noRepeat() {
        // elapsed 90s, previous tick was at 80s (>= 75s threshold) → not a crossing.
        assertFalse(shouldEmitPreBreach(90_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /** At/past the SLA the breach path takes over — no warning. */
    @Test
    void pastSla_noWarning() {
        assertFalse(shouldEmitPreBreach(100_000L, SLA_MS, 75.0, INTERVAL_MS));
        assertFalse(shouldEmitPreBreach(150_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /** Exactly AT the threshold (the >= edge) → emit. */
    @Test
    void exactlyAtThreshold_emits() {
        // threshold = 75% of 100s = 75s; elapsed is exactly 75s and the
        // previous tick (65s) was below it → this is the crossing tick.
        assertTrue(shouldEmitPreBreach(75_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /** The configured thresholdPercent moves the crossing point. */
    @Test
    void thresholdPercent_honored() {
        // elapsed 55s, previous tick 45s: crosses a 50% threshold (50s)
        // but is nowhere near a 75% threshold (75s).
        assertTrue(shouldEmitPreBreach(55_000L, SLA_MS, 50.0, INTERVAL_MS));
        assertFalse(shouldEmitPreBreach(55_000L, SLA_MS, 75.0, INTERVAL_MS));
    }

    /**
     * The dry-run window predicate is membership-only: true anywhere inside
     * [threshold, sla) — even ticks after the crossing, where
     * {@link EscalationScheduler#shouldEmitPreBreach} has gone silent.
     */
    @Test
    void window_membershipNotCrossing() {
        // threshold = 75% of 100s = 75s.
        assertTrue(isInPreBreachWindow(75_000L, SLA_MS, 75.0));  // at the threshold (>= edge)
        assertTrue(isInPreBreachWindow(90_000L, SLA_MS, 75.0));  // deep in the window — crossing long past
        assertFalse(isInPreBreachWindow(74_999L, SLA_MS, 75.0)); // just below the threshold
        assertFalse(isInPreBreachWindow(100_000L, SLA_MS, 75.0)); // at the SLA — breach path takes over
        assertFalse(isInPreBreachWindow(150_000L, SLA_MS, 75.0)); // well past the SLA
    }
}
