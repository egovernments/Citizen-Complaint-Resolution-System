package org.egov.novubridge.service.resolution;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Audience parsing: the one place a string in a config column becomes a decision about who gets a
 * message. Two properties matter more than the rest — the legacy bare names must keep working, and
 * an unknown scheme must never be guessed at.
 */
class AudienceRefTest {

    @Test
    @DisplayName("the three schemes parse into scheme and value")
    void theThreeSchemes() {
        assertEquals(List.of(new AudienceRef("ACTOR", "citizen", "ACTOR:citizen")),
                AudienceRef.parseChain("ACTOR:citizen"));
        assertEquals(List.of(new AudienceRef("ROLE", "GRO", "ROLE:GRO")),
                AudienceRef.parseChain("ROLE:GRO"));
        assertEquals(List.of(new AudienceRef("EVENT_RECIPIENTS", "", "EVENT_RECIPIENTS")),
                AudienceRef.parseChain("EVENT_RECIPIENTS"));
    }

    @Test
    @DisplayName("a pipe chain parses in order, and whitespace around a link is ignored")
    void aPipeChainKeepsItsOrder() {
        List<AudienceRef> chain = AudienceRef.parseChain(" ACTOR:assignee | ROLE:PGR_LME ");
        assertEquals(2, chain.size());
        assertEquals("ACTOR", chain.get(0).scheme());
        assertEquals("assignee", chain.get(0).value());
        assertEquals("ROLE", chain.get(1).scheme());
        assertEquals("PGR_LME", chain.get(1).value());
    }

    @Test
    @DisplayName("the legacy bare names read as the actors and roles they always meant")
    void theLegacyBareNames() {
        assertEquals(new AudienceRef("ACTOR", "citizen", "CITIZEN"),
                AudienceRef.parseChain("CITIZEN").get(0));
        assertEquals(new AudienceRef("ACTOR", "assignee", "EMPLOYEE"),
                AudienceRef.parseChain("EMPLOYEE").get(0));
        assertEquals(new AudienceRef("ROLE", "PGR_LME", "PGR_LME"),
                AudienceRef.parseChain("PGR_LME").get(0),
                "any other bare name is a role code — that is what the old column meant");
        assertEquals(new AudienceRef("ACTOR", "citizen", "citizen"),
                AudienceRef.parseChain("citizen").get(0), "case-insensitive: an operator types this");
    }

    @Test
    @DisplayName("AUTO_ESCALATE and SYSTEM are a deliberate nobody, not an unknown scheme")
    void thePseudoAudiences() {
        assertTrue(AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain("AUTO_ESCALATE")));
        assertTrue(AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain("SYSTEM")));
        assertFalse(AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain("ROLE:GRO")));
        assertFalse(AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain("AUTO_ESCALATE|ROLE:GRO")),
                "a chain with one real link is still a real audience");
        assertFalse(AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain("")),
                "a blank audience is a different fault, handled where the row is read");
    }

    @Test
    @DisplayName("an unknown scheme keeps its own name, so the ledger can say which one nobody answered for")
    void anUnknownSchemeIsPreserved() {
        AudienceRef ref = AudienceRef.parseChain("DEPARTMENT:PLANNING").get(0);
        assertEquals("DEPARTMENT", ref.scheme());
        assertEquals("PLANNING", ref.value());
        assertEquals("DEPARTMENT:PLANNING", ref.raw(),
                "the raw spelling is what an operator has to go and fix");
    }

    @Test
    @DisplayName("a blank audience parses to nothing at all")
    void aBlankAudience() {
        assertTrue(AudienceRef.parseChain(null).isEmpty());
        assertTrue(AudienceRef.parseChain("   ").isEmpty());
        assertTrue(AudienceRef.parseChain("|").isEmpty());
    }

    @Test
    @DisplayName("a role code containing a colon is an unknown scheme, and that is the right call")
    void aColonAlwaysMeansAScheme() {
        // There is no way to tell "a role literally named FOO:BAR" from "the scheme FOO" — and
        // guessing "role" would notify nobody while looking like config that works. An unknown
        // scheme is a visible SKIPPED row instead.
        assertEquals("FOO", AudienceRef.parseChain("FOO:BAR").get(0).scheme());
    }
}
