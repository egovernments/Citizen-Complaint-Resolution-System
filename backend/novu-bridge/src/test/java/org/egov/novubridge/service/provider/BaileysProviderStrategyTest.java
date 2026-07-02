package org.egov.novubridge.service.provider;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies BaileysProviderStrategy owns the bare WHATSAPP route without
 * colliding with WhatsAppBusinessApiProviderStrategy (the Meta path), and that
 * the factory selects Baileys for providerName="baileys".
 */
class BaileysProviderStrategyTest {

    private final BaileysProviderStrategy baileys = new BaileysProviderStrategy();
    private final WhatsAppBusinessApiProviderStrategy meta = new WhatsAppBusinessApiProviderStrategy();

    @Test
    void supportsBaileysAliases() {
        assertTrue(baileys.supports("baileys"));
        assertTrue(baileys.supports("baileys-whatsapp"));
        assertEquals("baileys", baileys.getProviderName());
        assertEquals(List.of("whatsapp"), Arrays.asList(baileys.getSupportedChannels()));
    }

    @Test
    void freeFormHasNoContentSidRequirement() {
        assertTrue(baileys.isContentSidValid(null));
        assertTrue(baileys.isContentSidValid(""));
        assertTrue(baileys.buildProviderConfig(null, null, null).isEmpty());
    }

    @Test
    void metaStrategyNoLongerClaimsBareWhatsapp() {
        // Critical: bare "whatsapp" must NOT be claimed by the Meta strategy,
        // otherwise the factory could shadow Baileys non-deterministically.
        assertFalse(meta.supports("whatsapp"));
        assertFalse(meta.supports("baileys"));
        assertTrue(meta.supports("whatsapp-business-api"));
        assertTrue(meta.supports("meta"));
    }

    @Test
    void baileysAndMetaDoNotOverlap() {
        for (String name : List.of("baileys", "baileys-whatsapp")) {
            assertTrue(baileys.supports(name));
            assertFalse(meta.supports(name));
        }
        for (String name : List.of("whatsapp-business-api", "meta")) {
            assertTrue(meta.supports(name));
            assertFalse(baileys.supports(name));
        }
    }
}
