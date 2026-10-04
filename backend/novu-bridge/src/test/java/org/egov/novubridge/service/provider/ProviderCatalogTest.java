package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SMSCountry, Ozeki and Jasmin are DIGIT's providers mounted into the Novu worker. These pin the
 * catalog to their contract: the Novu provider ids and credential keys below are what the
 * handlers in {@code backend/novu-bridge/novu-worker-providers} read. A drift here saves fine and
 * fails every send inside Novu.
 */
class ProviderCatalogTest {

    private ProviderCatalog catalog;

    @BeforeEach
    void setUp() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        catalog = new ProviderCatalog(config);
    }

    private static Set<String> keys(ProviderType type) {
        return type.getCredentialFields().stream().map(CredentialField::getKey).collect(Collectors.toSet());
    }

    private static Set<String> requiredKeys(ProviderType type) {
        return type.getCredentialFields().stream().filter(CredentialField::isRequired)
                .map(CredentialField::getKey).collect(Collectors.toSet());
    }

    @Test
    void theDigitGatewaysAreNovuProviders_withTheirIdsAndCredentialKeys() {
        // The keys the handlers' buildProvider reads (novu-worker-providers/<id>.js).
        Map<String, Set<String>> providerKeys = Map.of(
                "smscountry", Set.of("user", "password", "baseUrl", "from"),
                "ozeki", Set.of("baseUrl", "user", "password", "from"),
                "jasmin", Set.of("baseUrl", "user", "password", "from"));
        for (Map.Entry<String, Set<String>> e : providerKeys.entrySet()) {
            ProviderType type = catalog.require(e.getKey());
            assertEquals("novu", type.getTransport(), e.getKey());
            assertEquals(e.getKey(), type.getNovuProviderId(), e.getKey());
            assertEquals("SMS", type.getChannel(), e.getKey());
            assertEquals("sms", type.novuChannel(), e.getKey());
            assertEquals(e.getValue(), keys(type), e.getKey());
        }
        // The one required field each gateway cannot work without beyond the login.
        assertEquals(Set.of("user", "password", "from"), requiredKeys(catalog.require("smscountry")));
        assertEquals(Set.of("baseUrl", "user", "password"), requiredKeys(catalog.require("ozeki")));
        assertEquals(Set.of("baseUrl", "user", "password"), requiredKeys(catalog.require("jasmin")));
    }

    @Test
    void noCatalogTypeRidesGenericSmsAnyMore() {
        for (ProviderType type : catalog.types()) {
            assertEquals("novu", type.getTransport(), type.getType());
            assertTrue(!"generic-sms".equals(type.getNovuProviderId()), type.getType());
        }
        assertEquals(List.of("twilio-sms", "twilio-whatsapp", "smtp", "smscountry", "ozeki", "jasmin"),
                catalog.types().stream().map(ProviderType::getType).toList());
    }

    @Test
    void jasminHelpSaysNonGsmTextCostsMoreSegments() {
        String help = catalog.require("jasmin").getCredentialFields().stream()
                .map(CredentialField::getHelp).filter(h -> h != null && h.contains("UCS-2"))
                .findFirst().orElse("");
        assertTrue(help.contains("70 characters"), help);
        assertTrue(help.contains("160"), help);
    }

    @Test
    void smsCountryCredentials_areCopiedOneToOne_andABlankGatewayUrlIsLeftToTheProvidersDefault() {
        Map<String, Object> form = new LinkedHashMap<>();
        form.put("user", " panel-user ");
        form.put("password", "p@ss word");
        form.put("from", "KEGOV");
        form.put("baseUrl", "  ");
        form.put("apiKey", "smuggled");

        Map<String, Object> novu = catalog.toNovuCredentials(catalog.require("smscountry"), form);

        assertEquals(Map.of("user", "panel-user", "password", "p@ss word", "from", "KEGOV"), novu);
    }

    @Test
    void smsCountryCredentials_keepAGatewayUrlWhenOneIsGiven() {
        Map<String, Object> form = Map.of("user", "u", "password", "p", "from", "KEGOV",
                "baseUrl", "http://sms-mock:8080/SMSCwebservice_bulk.aspx");

        Map<String, Object> novu = catalog.toNovuCredentials(catalog.require("smscountry"), form);

        assertEquals("http://sms-mock:8080/SMSCwebservice_bulk.aspx", novu.get("baseUrl"));
        assertNull(novu.get("apiKeyRequestHeader"), "no generic-sms header mapping any more");
    }

    @Test
    void ozekiAndJasminCredentials_areCopiedOneToOne_andABlankSenderIsLeftOut() {
        Map<String, Object> ozeki = catalog.toNovuCredentials(catalog.require("ozeki"), Map.of(
                "baseUrl", "http://ozeki:9509/api?action=sendmsg", "user", "http_user", "password", "pw",
                "from", ""));
        assertEquals(Map.of("baseUrl", "http://ozeki:9509/api?action=sendmsg", "user", "http_user",
                "password", "pw"), ozeki);

        Map<String, Object> jasmin = catalog.toNovuCredentials(catalog.require("jasmin"), Map.of(
                "baseUrl", "http://jasmin:1401/send", "user", "foo", "password", "bar", "from", "ETGOV"));
        assertEquals(Map.of("baseUrl", "http://jasmin:1401/send", "user", "foo", "password", "bar",
                "from", "ETGOV"), jasmin);
    }

    @Test
    void jasminWithoutItsSendUrl_isRefusedBeforeNovu() {
        Map<String, Object> form = new HashMap<>(Map.of("user", "foo", "password", "bar"));
        CustomException ex = assertThrows(CustomException.class,
                () -> catalog.validateRequired(catalog.require("jasmin"), form));
        assertEquals("NB_INVALID_PROVIDER", ex.getCode());
        assertTrue(ex.getMessage().contains("baseUrl"), ex.getMessage());
    }

    @Test
    void identifiersReadBackAsTheirType_jasminIncluded() {
        assertEquals("jasmin", ProviderCatalog.typeFromIdentifier("jasmin-0011aabbccddeeff"));
        assertEquals("jasmin", ProviderCatalog.typeFromIdentifier(" JASMIN "));
        assertEquals("smscountry", ProviderCatalog.typeFromIdentifier("smscountry-main"));
        assertEquals("ozeki", ProviderCatalog.typeFromIdentifier("ozeki-main"));
        assertNull(ProviderCatalog.typeFromIdentifier("jasminx"));
        assertTrue(ProviderCatalog.identifierFor("jasmin", "Ethio Telecom").startsWith("jasmin-"));
    }

    @Test
    void unmarkedNativeIntegrations_deriveTheirType_butGenericSmsStaysUnknown() {
        assertEquals("smscountry", ProviderCatalog.deriveType(Map.of("providerId", "smscountry", "channel", "sms")));
        assertEquals("ozeki", ProviderCatalog.deriveType(Map.of("providerId", "ozeki", "channel", "sms")));
        assertEquals("jasmin", ProviderCatalog.deriveType(Map.of("providerId", "jasmin", "channel", "sms")));
        assertEquals("twilio-sms", ProviderCatalog.deriveType(Map.of("providerId", "twilio", "channel", "sms")));
        assertNull(ProviderCatalog.deriveType(Map.of("providerId", "generic-sms", "channel", "sms")));
        assertNull(ProviderCatalog.deriveType(Map.of("providerId", "jasmin", "channel", "email")));
    }
}
