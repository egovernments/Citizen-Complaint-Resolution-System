package org.egov.pgr.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins the ladder precedence: a complaint type's own override beats the global defaults,
 * and within each level a percentage ladder beats a millisecond one.
 */
class EscalationLadderPrecedenceTest {

    private static final String TYPE = "PWTESTESCALATION";
    private static final long ONE_HOUR = 3_600_000L;
    private static final List<Long> DEFAULT_PERCENTAGES = List.of(80L, 120L, 200L);
    private static final List<Long> DEFAULT_SLAS = List.of(ONE_HOUR, 4 * ONE_HOUR, 24 * ONE_HOUR);

    private static EscalationConfigurationService.ResolvedEscalationConfig config(Object override) {
        Map<String, Object> overrides = override == null ? Map.of() : Map.of(TYPE, override);
        return new EscalationConfigurationService.ResolvedEscalationConfig(3, DEFAULT_PERCENTAGES,
                DEFAULT_SLAS, List.of(), List.of("PENDINGATLME"), overrides, Map.of(TYPE, ONE_HOUR));
    }

    @Test
    void typeMillisecondOverrideBeatsGlobalPercentages() {
        EscalationConfigurationService.ResolvedEscalationConfig config = config(List.of(60_000, 120_000));

        assertEquals(60_000L, config.resolveSla(TYPE, 0));
        assertEquals(120_000L, config.resolveSla(TYPE, 1));
        assertEquals(2, config.effectiveMaxDepth(TYPE));
    }

    @Test
    void structuredMillisecondOverrideBeatsGlobalPercentages() {
        EscalationConfigurationService.ResolvedEscalationConfig config =
                config(Map.of("slaByLevel", List.of(60_000, 120_000)));

        assertEquals(60_000L, config.resolveSla(TYPE, 0));
        assertEquals(2, config.effectiveMaxDepth(TYPE));
    }

    @Test
    void typePercentageOverrideBeatsTypeMilliseconds() {
        EscalationConfigurationService.ResolvedEscalationConfig config = config(Map.of(
                "slaPercentageByLevel", List.of(50, 100),
                "slaByLevel", List.of(60_000, 120_000)));

        assertEquals(ONE_HOUR / 2, config.resolveSla(TYPE, 0));
        assertEquals(ONE_HOUR, config.resolveSla(TYPE, 1));
        assertEquals(2, config.effectiveMaxDepth(TYPE));
    }

    @Test
    void withoutOverrideGlobalPercentagesBeatGlobalMilliseconds() {
        EscalationConfigurationService.ResolvedEscalationConfig config = config(null);

        assertEquals(ONE_HOUR * 80 / 100, config.resolveSla(TYPE, 0));
        assertEquals(3, config.effectiveMaxDepth(TYPE));
    }

    @Test
    void typeWithoutSlaHoursFallsBackToGlobalMilliseconds() {
        EscalationConfigurationService.ResolvedEscalationConfig config = config(null);

        assertEquals(ONE_HOUR, config.resolveSla("NO_SLA_TYPE", 0));
        assertEquals(3, config.effectiveMaxDepth("NO_SLA_TYPE"));
    }
}
