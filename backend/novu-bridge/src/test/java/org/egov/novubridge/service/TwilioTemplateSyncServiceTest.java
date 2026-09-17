package org.egov.novubridge.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The bridge only tokenises Twilio names; PGR routing knowledge lives in the configurator. */
class TwilioTemplateSyncServiceTest {

    @Test
    void tokensAreLowercasedAndSplitOnUnderscore() {
        assertEquals(List.of("complaints", "citizen", "assign", "pendingatlme", "message", "new"),
                TwilioTemplateSyncService.tokens("Complaints_Citizen_ASSIGN_PendingAtLme_message_new"));
    }

    @Test
    void blankNameHasNoTokens() {
        assertTrue(TwilioTemplateSyncService.tokens(null).isEmpty());
        assertTrue(TwilioTemplateSyncService.tokens("  ").isEmpty());
    }
}
