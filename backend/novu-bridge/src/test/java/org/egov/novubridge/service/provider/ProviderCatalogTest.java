package org.egov.novubridge.service.provider;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The catalog is the contract the configurator codes against: the five types, their field
 * keys, and the type&lt;-&gt;identifier round trip the dispatch path depends on. Getting the
 * Novu credential mapping wrong here produces an integration Novu stores happily and then
 * fails every send with.
 */
class ProviderCatalogTest {

    private static final String ADAPTER_URL =
            "http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send";

    private ProviderCatalog catalog;

    @BeforeEach
    void setUp() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setSmsCountryAdapterUrl(ADAPTER_URL);
        catalog = new ProviderCatalog(config);
    }

    // ---- catalog contents ------------------------------------------------

    @Test
    void exposesExactlyTheFiveAgreedTypes() {
        List<String> types = catalog.types().stream().map(ProviderType::getType).collect(Collectors.toList());
        assertEquals(List.of("twilio-sms", "twilio-whatsapp", "smtp", "smscountry", "ozeki"), types);
    }

    @Test
    void everyTypeDeclaresAChannelTransportAndNovuProviderId() {
        for (ProviderType t : catalog.types()) {
            assertTrue(Set.of("SMS", "EMAIL", "WHATSAPP").contains(t.getChannel()), t.getType() + " channel");
            assertTrue(Set.of("novu", "novu-generic-sms", "bridge-adapter").contains(t.getTransport()),
                    t.getType() + " transport");
            assertTrue(t.getNovuProviderId() != null && !t.getNovuProviderId().isBlank(), t.getType());
            assertFalse(t.getCredentialFields().isEmpty(), t.getType() + " must ask for something");
            for (CredentialField f : t.getCredentialFields()) {
                assertTrue(Set.of("text", "password", "checkbox").contains(f.getType()),
                        t.getType() + "." + f.getKey() + " has field type " + f.getType());
            }
        }
    }

    @Test
    void whatsappRidesNovusSmsChannel_andEmailIsTheOnlyEmailChannel() {
        assertEquals("sms", catalog.require("twilio-whatsapp").novuChannel());
        assertEquals("sms", catalog.require("twilio-sms").novuChannel());
        assertEquals("sms", catalog.require("smscountry").novuChannel());
        assertEquals("sms", catalog.require("ozeki").novuChannel());
        assertEquals("email", catalog.require("smtp").novuChannel());
    }

    @Test
    void everyTypeOffersTheStatusCheckAndATestSend() {
        // /providers/verify only asks Novu whether the integration exists and is on — it
        // proves no credential for any type, so no type is special. Hiding it for SMSCountry
        // and Ozeki while Twilio and SMTP showed the same check implied a difference there
        // was not. Sending a test is the credential proof, for every type.
        assertTrue(catalog.types().stream().allMatch(ProviderType::isSupportsVerify));
        assertTrue(catalog.types().stream().allMatch(ProviderType::isSupportsTestSend));
    }

    @Test
    void smtpKeepsTheNodemailerFieldKeys_withPortAsText() {
        Map<String, CredentialField> fields = fieldsOf("smtp");
        assertEquals(Set.of("host", "port", "user", "password", "from", "senderName", "secure"), fields.keySet());
        // Novu's CredentialsDto declares port as @IsString: a JSON number fails validation.
        assertEquals("text", fields.get("port").getType());
        assertEquals("checkbox", fields.get("secure").getType());
        assertEquals("password", fields.get("password").getType());
    }

    @Test
    void twilioKeepsTheThreeKeysTheExistingCreatePathUses() {
        assertEquals(Set.of("accountSid", "token", "from"), fieldsOf("twilio-sms").keySet());
        assertEquals(Set.of("accountSid", "token", "from"), fieldsOf("twilio-whatsapp").keySet());
    }

    @Test
    void smsCountryApiUrlIsOptional_andDefaultsToTheConfiguredGateway() {
        CredentialField apiUrl = fieldsOf("smscountry").get("apiUrl");
        assertFalse(apiUrl.isRequired());
        assertEquals("http://api.smscountry.com/SMSCwebservice_bulk.aspx", apiUrl.getPlaceholder());
    }

    @Test
    void catalogJsonCarriesNoCredentialValues() throws Exception {
        String json = new ObjectMapper().writeValueAsString(catalog.types());
        // The catalog describes what to ASK for. It must never carry a stored value.
        assertFalse(json.contains("\"value\""), json);
        assertFalse(json.contains("credentials"), json);
        assertTrue(json.contains("\"supportsVerify\""));
        assertTrue(json.contains("\"credentialFields\""));
    }

    @Test
    void unknownTypeIsRefusedByCode() {
        CustomException e = assertThrows(CustomException.class, () -> catalog.require("sendgrid"));
        assertEquals("NB_UNKNOWN_PROVIDER_TYPE", e.getCode());
        assertEquals("NB_UNKNOWN_PROVIDER_TYPE", assertThrows(CustomException.class,
                () -> catalog.require(" ")).getCode());
    }

    // ---- identifier <-> type round trip ----------------------------------

    @Test
    void identifierRoundTripsBackToItsType_forEveryType() {
        for (ProviderType t : catalog.types()) {
            String identifier = ProviderCatalog.identifierFor(t.getType(), "Our " + t.getLabel());
            assertEquals(t.getType(), ProviderCatalog.typeFromIdentifier(identifier),
                    "identifier " + identifier + " must round-trip");
        }
    }

    @Test
    void twilioWhatsappIdentifierNeverResolvesToTwilioSms() {
        // The two share a prefix word; longest-first matching is what keeps them apart, and
        // getting it wrong would send WhatsApp through the plain-SMS sender.
        String wa = ProviderCatalog.identifierFor("twilio-whatsapp", "Gov WhatsApp");
        assertEquals("twilio-whatsapp", ProviderCatalog.typeFromIdentifier(wa));
        String sms = ProviderCatalog.identifierFor("twilio-sms", "Gov SMS");
        assertEquals("twilio-sms", ProviderCatalog.typeFromIdentifier(sms));
    }

    @Test
    void identifierIsDeterministic_noClockOrRandom() {
        assertEquals(ProviderCatalog.identifierFor("smtp", "City Mail"),
                ProviderCatalog.identifierFor("smtp", "City Mail"));
    }

    @Test
    void preCatalogWhatsappMarkerStillResolves() {
        assertEquals("twilio-whatsapp", ProviderCatalog.typeFromIdentifier("whatsapp-a1b2c3d4"));
    }

    @Test
    void unmarkedIdentifierYieldsNull_ratherThanAGuess() {
        assertNull(ProviderCatalog.typeFromIdentifier("my-hand-made-integration"));
        assertNull(ProviderCatalog.typeFromIdentifier(""));
        assertNull(ProviderCatalog.typeFromIdentifier(null));
    }

    @Test
    void deriveTypeFallsBackToProviderIdAndChannel_butNeverGuessesBetweenGenericSmsGateways() {
        assertEquals("twilio-sms", ProviderCatalog.deriveType(Map.of("providerId", "twilio", "channel", "sms")));
        assertEquals("smtp", ProviderCatalog.deriveType(Map.of("providerId", "nodemailer", "channel", "email")));
        // generic-sms with no marker could be SMSCountry OR Ozeki; guessing would attach the
        // wrong request envelope, so it stays unknown.
        assertNull(ProviderCatalog.deriveType(Map.of("providerId", "generic-sms", "channel", "sms")));
        assertNull(ProviderCatalog.deriveType(null));
    }

    @Test
    void identifierMarkerBeatsTheProviderIdFallback() {
        Map<String, Object> integration = Map.of(
                "providerId", "generic-sms", "channel", "sms",
                "identifier", ProviderCatalog.identifierFor("ozeki", "Ozeki box"));
        assertEquals("ozeki", ProviderCatalog.deriveType(integration));
    }

    // ---- credential mapping ----------------------------------------------

    @Test
    void twilioCredentialsPassThroughUnchanged() {
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("twilio-sms"),
                Map.of("accountSid", "ACxx", "token", "tok", "from", "+15550100"));
        assertEquals(Map.of("accountSid", "ACxx", "token", "tok", "from", "+15550100"), out);
    }

    @Test
    void smtpCheckboxBecomesABoolean_andPortStaysAString() {
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("host", "smtp.example.org");
        in.put("port", "587");
        in.put("user", "u");
        in.put("password", "p");
        in.put("from", "no-reply@example.org");
        in.put("senderName", "Desk");
        in.put("secure", "true");
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("smtp"), in);
        assertEquals("587", out.get("port"));
        assertEquals(Boolean.TRUE, out.get("secure"));
    }

    @Test
    void unknownKeysAreNotSmuggledIntoTheNovuCredentialStore() {
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("twilio-sms"),
                Map.of("accountSid", "ACxx", "token", "tok", "from", "+1", "webhookUrl", "http://evil"));
        assertFalse(out.containsKey("webhookUrl"));
    }

    @Test
    void smsCountryBecomesAGenericSmsIntegrationPointedAtTheBridgeAdapter() {
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("smscountry"),
                Map.of("user", "panel-user", "password", "panel-pass", "senderId", "KE-GOV"));

        // Novu POSTs at baseUrl verbatim (no path appended), so it must be the whole URL.
        assertEquals(ADAPTER_URL, out.get("baseUrl"));
        // apiKey/secretKey are VALUES; the *RequestHeader keys are the header NAMES the
        // adapter reads them back from.
        assertEquals("panel-user", out.get("apiKey"));
        assertEquals("X-SMSCountry-User", out.get("apiKeyRequestHeader"));
        assertEquals("panel-pass", out.get("secretKey"));
        assertEquals("X-SMSCountry-Password", out.get("secretKeyRequestHeader"));
        // generic-sms puts `from` in the JSON body, which is how the sender id reaches us.
        assertEquals("KE-GOV", out.get("from"));
        // idPath is a required credential and generic-sms reads it with an unguarded reduce.
        assertEquals("id", out.get("idPath"));
        assertEquals("date", out.get("datePath"));
        // The panel login must never end up anywhere but the two credential value slots.
        assertFalse(out.get("baseUrl").toString().contains("panel-pass"));
    }

    @Test
    void smsCountryApiUrlOverrideRidesAsAQueryParamOnTheAdapterUrl() {
        // generic-sms has no credential slot for a second URL (`domain` is the token-auth URL),
        // so the only place a per-integration gateway endpoint can travel is the baseUrl query.
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("smscountry"),
                Map.of("user", "u", "password", "p", "senderId", "SID",
                        "apiUrl", "https://alt.smscountry.test/send"));
        String baseUrl = out.get("baseUrl").toString();
        assertTrue(baseUrl.startsWith(ADAPTER_URL + "?"), baseUrl);
        assertTrue(baseUrl.contains("apiUrl="), baseUrl);
        assertTrue(baseUrl.contains("alt.smscountry.test"), baseUrl);
    }

    @Test
    void ozekiKeepsItsOwnGatewayAsTheBaseUrl_notTheBridgeAdapter() {
        Map<String, Object> out = catalog.toNovuCredentials(catalog.require("ozeki"),
                Map.of("baseUrl", "https://ozeki.test:9509/api?action=sendmessage",
                        "username", "ozuser", "password", "ozpass", "senderId", "GOV"));
        assertEquals("https://ozeki.test:9509/api?action=sendmessage", out.get("baseUrl"));
        assertEquals("ozuser", out.get("apiKey"));
        assertEquals("ozpass", out.get("secretKey"));
        assertEquals("GOV", out.get("from"));
        assertFalse(out.get("baseUrl").toString().contains("novu-bridge"),
                "Ozeki talks to its own gateway; only SMSCountry needs the adapter");
    }

    // ---- required-field validation ---------------------------------------

    @Test
    void missingRequiredCredentialsAreNamedBeforeAnythingReachesNovu() {
        CustomException e = assertThrows(CustomException.class, () -> catalog.validateRequired(
                catalog.require("smscountry"), Map.of("user", "u")));
        assertEquals("NB_INVALID_PROVIDER", e.getCode());
        assertTrue(e.getMessage().contains("password"), e.getMessage());
        assertTrue(e.getMessage().contains("senderId"), e.getMessage());
    }

    @Test
    void blankAndNullAreBothMissing() {
        Map<String, Object> credentials = new LinkedHashMap<>();
        credentials.put("accountSid", "   ");
        credentials.put("token", null);
        CustomException e = assertThrows(CustomException.class,
                () -> catalog.validateRequired(catalog.require("twilio-sms"), credentials));
        assertTrue(e.getMessage().contains("accountSid"), e.getMessage());
        assertTrue(e.getMessage().contains("token"), e.getMessage());
        assertTrue(e.getMessage().contains("from"), e.getMessage());
    }

    @Test
    void optionalFieldsAreNotRequired() {
        // Nothing thrown: apiUrl is optional on smscountry, secure/senderName are the only
        // optionals on smtp.
        catalog.validateRequired(catalog.require("smscountry"),
                Map.of("user", "u", "password", "p", "senderId", "S"));
        catalog.validateRequired(catalog.require("ozeki"),
                Map.of("baseUrl", "https://x/api", "username", "u", "password", "p"));
    }

    private Map<String, CredentialField> fieldsOf(String type) {
        ProviderType t = catalog.require(type);
        assertNotNull(t);
        Map<String, CredentialField> out = new LinkedHashMap<>();
        for (CredentialField f : t.getCredentialFields()) {
            out.put(f.getKey(), f);
        }
        return out;
    }
}
