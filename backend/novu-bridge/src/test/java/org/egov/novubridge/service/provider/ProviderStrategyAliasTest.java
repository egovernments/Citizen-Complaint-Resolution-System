package org.egov.novubridge.service.provider;

import org.egov.novubridge.web.models.ResolvedProvider;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * NB-1: after the Baileys strategy was removed by W1, the bare {@code "whatsapp"}
 * provider alias is owned by exactly one concrete (non-generic) strategy —
 * {@link WhatsAppBusinessApiProviderStrategy}. This pins the ownership so a future
 * strategy addition can't silently re-introduce an ambiguous WhatsApp mapping.
 *
 * <p>Note: {@link GenericProviderStrategy#supports(String)} returns {@code true}
 * for everything (it is the catch-all fallback), so the exclusivity claim only
 * holds over the NON-generic strategies — which is precisely the set the
 * {@link NovuProviderStrategyFactory} filters on first (it skips the generic
 * strategy in its first pass before falling back to it).
 */
class ProviderStrategyAliasTest {

    /** All concrete strategies the Spring context wires today (Baileys is gone). */
    private List<NovuProviderStrategy> allStrategies() {
        return List.of(
                new TwilioProviderStrategy(),
                new ValueFirstProviderStrategy(),
                new VonageProviderStrategy(),
                new WhatsAppBusinessApiProviderStrategy(),
                new GenericProviderStrategy());
    }

    @Test
    void exactlyOneNonGenericStrategy_ownsBareWhatsappAlias() {
        List<NovuProviderStrategy> owners = allStrategies().stream()
                .filter(s -> !(s instanceof GenericProviderStrategy))
                .filter(s -> s.supports("whatsapp"))
                .toList();

        assertEquals(1, owners.size(), "exactly one non-generic strategy must own the bare 'whatsapp' alias");
        assertInstanceOf(WhatsAppBusinessApiProviderStrategy.class, owners.get(0));
    }

    @Test
    void whatsappAliasOwnership_isCaseInsensitive() {
        WhatsAppBusinessApiProviderStrategy meta = new WhatsAppBusinessApiProviderStrategy();
        assertTrue(meta.supports("whatsapp"));
        assertTrue(meta.supports("WHATSAPP"));
        assertTrue(meta.supports("WhatsApp"));
        assertTrue(meta.supports("whatsapp-business-api"));
        assertTrue(meta.supports("meta"));
    }

    @Test
    void factoryResolvesWhatsappToMetaStrategy_notGeneric() {
        // The factory skips the generic strategy in its first pass, so a bare
        // "whatsapp" provider resolves to the Meta strategy despite Generic.supports==true.
        GenericProviderStrategy generic = new GenericProviderStrategy();
        NovuProviderStrategyFactory factory = new NovuProviderStrategyFactory(allStrategies(), generic);

        NovuProviderStrategy resolved =
                factory.getStrategy(ResolvedProvider.builder().providerName("whatsapp").build());

        assertInstanceOf(WhatsAppBusinessApiProviderStrategy.class, resolved);
    }
}
