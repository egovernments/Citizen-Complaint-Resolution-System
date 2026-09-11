package org.egov.pgr.service.notification;

import org.egov.pgr.util.MDMSUtils;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class NotificationRouterTest {

    private static final String TENANT = "ke.bomet";

    @Mock
    private MDMSUtils mdmsUtils;

    @InjectMocks
    private NotificationRouter router;

    /** One flattened NotificationRouting row: a single (audience, channel) pair. */
    private Map<String, Object> row(String fromState, String action, String toState,
                                    String audience, String channel) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("businessService", "PGR");
        m.put("fromState", fromState);
        m.put("action", action);
        m.put("toState", toState);
        m.put("audience", audience);
        m.put("channel", channel);
        m.put("active", true);
        return m;
    }

    /** A row with an explicit assigneeOnly opt-in flag. */
    private Map<String, Object> row(String fromState, String action, String toState,
                                    String audience, String channel, boolean assigneeOnly) {
        Map<String, Object> m = row(fromState, action, toState, audience, channel);
        m.put("assigneeOnly", assigneeOnly);
        return m;
    }

    private void seed(Object... rows) {
        when(mdmsUtils.getNotificationRouting(TENANT)).thenReturn(new ArrayList<>(Arrays.asList(rows)));
    }

    /** Collapse matches into a set of "AUDIENCE|CHANNEL" pairs for order-independent assertions. */
    private static Set<String> pairs(List<RoutingMatch> matches) {
        Set<String> out = new LinkedHashSet<>();
        for (RoutingMatch m : matches) {
            out.add(m.getAudience() + "|" + m.getChannel());
        }
        return out;
    }

    @Test
    void assign_routesToCitizenAndEmployee() {
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "EMPLOYEE", "SMS")
        );
        List<RoutingMatch> matches = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(2, matches.size());
        assertEquals(new LinkedHashSet<>(Arrays.asList("CITIZEN|SMS", "EMPLOYEE|SMS")), pairs(matches));
    }

    @Test
    void apply_routesToCitizenOnly() {
        seed(row(null, "APPLY", "PENDINGFORASSIGNMENT", "CITIZEN", "SMS"));
        List<RoutingMatch> matches = router.route(TENANT, "PGR", null, "APPLY", "PENDINGFORASSIGNMENT");
        assertEquals(1, matches.size());
        assertEquals("CITIZEN", matches.get(0).getAudience());
        assertEquals("SMS", matches.get(0).getChannel());
    }

    @Test
    void multiChannel_oneMatchPerRow() {
        seed(
            row(null, "APPLY", "PENDINGFORASSIGNMENT", "CITIZEN", "SMS"),
            row(null, "APPLY", "PENDINGFORASSIGNMENT", "CITIZEN", "WHATSAPP"),
            row(null, "APPLY", "PENDINGFORASSIGNMENT", "CITIZEN", "EMAIL")
        );
        List<RoutingMatch> matches = router.route(TENANT, "PGR", null, "APPLY", "PENDINGFORASSIGNMENT");
        assertEquals(3, matches.size());
        assertEquals(new LinkedHashSet<>(Arrays.asList("CITIZEN|SMS", "CITIZEN|WHATSAPP", "CITIZEN|EMAIL")),
                pairs(matches));
    }

    @Test
    void rate_disambiguatesByToState() {
        seed(
            row("RESOLVED", "RATE", "CLOSEDAFTERRESOLUTION", "EMPLOYEE", "SMS"),
            row("REJECTED", "RATE", "CLOSEDAFTERREJECTION", "CITIZEN", "SMS")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "RATE", "CLOSEDAFTERRESOLUTION");
        assertEquals(1, res.size());
        assertEquals("EMPLOYEE", res.get(0).getAudience());
        assertEquals("SMS", res.get(0).getChannel());
    }

    @Test
    void noMatch_returnsEmpty() {
        seed(row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"));
        assertTrue(router.route(TENANT, "PGR", null, "COMMENT", "PENDINGATLME").isEmpty());
    }

    @Test
    void roleAudience_isNowKept_asFreeString() {
        // GRO/PGR_LME are no longer "unknown" — audience is any role string, kept verbatim.
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "PGR_LME", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "GRO", "WHATSAPP")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(3, res.size());
        assertEquals(new LinkedHashSet<>(Arrays.asList("CITIZEN|SMS", "PGR_LME|SMS", "GRO|WHATSAPP")),
                pairs(res));
    }

    @Test
    void assigneeOnly_parsedFromRow_defaultsFalse() {
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "PGR_LME", "SMS", true),
            row(null, "ASSIGN", "PENDINGATLME", "GRO", "SMS")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(2, res.size());
        for (RoutingMatch m : res) {
            if ("PGR_LME".equals(m.getAudience())) assertTrue(m.isAssigneeOnly());
            if ("GRO".equals(m.getAudience())) assertFalse(m.isAssigneeOnly());
        }
    }

    @Test
    void nonNotifiableAudiences_areDropped() {
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "AUTO_ESCALATE", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "SYSTEM", "EMAIL"),
            row(null, "ASSIGN", "PENDINGATLME", "PGR_LME", "SMS")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(1, res.size());
        assertEquals("PGR_LME", res.get(0).getAudience());
    }

    @Test
    void unknownChannel_isSkipped_validKept() {
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "PIGEON")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(1, res.size());
        assertEquals("SMS", res.get(0).getChannel());
    }

    @Test
    void unknownChannel_dropsRow_evenForRoleAudience() {
        seed(
            row(null, "ASSIGN", "PENDINGATLME", "GRO", "SMS"),
            row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "PIGEON")
        );
        List<RoutingMatch> res = router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME");
        assertEquals(1, res.size());
        assertEquals("GRO", res.get(0).getAudience());
        assertEquals("SMS", res.get(0).getChannel());
    }

    @Test
    void inactiveRow_isSkipped() {
        Map<String, Object> r = row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS");
        r.put("active", false);
        seed(r);
        assertTrue(router.route(TENANT, "PGR", null, "ASSIGN", "PENDINGATLME").isEmpty());
    }

    @Test
    void fromState_optional_matchesWhenRowBlank() {
        seed(row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"));
        assertEquals(1, router.route(TENANT, "PGR", "PENDINGFORREASSIGNMENT", "ASSIGN", "PENDINGATLME").size());
    }

    @Test
    void fromState_specific_filtersWhenSet() {
        seed(row("PENDINGATLME", "REASSIGN", "PENDINGFORREASSIGNMENT", "CITIZEN", "SMS"));
        assertEquals(1, router.route(TENANT, "PGR", "PENDINGATLME", "REASSIGN", "PENDINGFORREASSIGNMENT").size());
        // different fromState supplied -> filtered out
        assertTrue(router.route(TENANT, "PGR", "SOMEWHERE", "REASSIGN", "PENDINGFORREASSIGNMENT").isEmpty());
    }

    @Test
    void fromState_authored_butRuntimeSuppliesNone_stillMatches() {
        // B19: an authored fromState can't be enforced when the runtime path passes fromState=null
        // (the config-driven emitter always does). The row must still match — behavior pinned; the
        // router additionally logs a WARN that the constraint is unenforceable (not asserted here).
        seed(row("PENDINGATLME", "REASSIGN", "PENDINGFORREASSIGNMENT", "CITIZEN", "SMS"));
        assertEquals(1, router.route(TENANT, "PGR", null, "REASSIGN", "PENDINGFORREASSIGNMENT").size());
    }

    @Test
    void blankActionOrToState_returnsEmpty() {
        seed(row(null, "ASSIGN", "PENDINGATLME", "CITIZEN", "SMS"));
        assertTrue(router.route(TENANT, "PGR", null, null, "PENDINGATLME").isEmpty());
        assertTrue(router.route(TENANT, "PGR", null, "ASSIGN", null).isEmpty());
    }
}
