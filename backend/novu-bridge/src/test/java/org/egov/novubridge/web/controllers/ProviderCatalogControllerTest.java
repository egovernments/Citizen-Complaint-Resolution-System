package org.egov.novubridge.web.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.web.models.ProviderCreateResponse;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The catalog-era provider management surface: {@code GET /providers/catalog},
 * type-based {@code POST /providers}, {@code POST /providers/_update} and
 * {@code POST /providers/_delete}. Ids travel in the BODY because the DIGIT gateway's access
 * control matches exact URLs.
 *
 * <p>The invariant every one of these shares with the pre-catalog endpoints: no operator
 * credential ever comes back out.
 */
class ProviderCatalogControllerTest {

    private static final String ADAPTER_URL =
            "http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send";

    private NovuClient novuClient;
    private RestTemplate mdms;
    private NovuBridgeConfiguration config;
    private ChannelPolicyClient policy;
    private ProviderController controller;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        mdms = mock(RestTemplate.class);
        DispatchLogRepository dispatchLogRepository = mock(DispatchLogRepository.class);
        TwilioTemplateSyncService twilio = mock(TwilioTemplateSyncService.class);

        config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setSmsCountryAdapterUrl(ADAPTER_URL);
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("RAINMAKER-PGR.NotificationChannel");
        config.setChannelPolicyCacheTtlMs(60_000L);
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setChannelsEnabled(List.of(""));

        policy = new ChannelPolicyClient(mdms, config);
        controller = new ProviderController(novuClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient, config), null),
                dispatchLogRepository, twilio, new ProviderCatalog(config), policy,
                new ProviderAvailability(novuClient, config));
        when(novuClient.applyWhatsappIntegrationOverride(anyMap(), anyString()))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    private static NovuClient.NovuResponse novuResp(int status, Map<String, Object> body) {
        return NovuClient.NovuResponse.builder().statusCode(status).response(body).build();
    }

    private void stubCreate(Map<String, Object> created) {
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class), anyBoolean()))
                .thenReturn(novuResp(201, Map.of("data", created)));
    }

    private void stubIntegrations(Map<String, Object>... integrations) {
        when(novuClient.listIntegrations()).thenReturn(novuResp(200, Map.of("data", List.of(integrations))));
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubChannelRows(Map<String, Object>... rows) {
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", List.of(rows)), HttpStatus.OK));
    }

    private static Map<String, Object> channelRow(String code, String provider) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("enabled", true);
        data.put("active", true);
        if (provider != null) {
            data.put("provider", provider);
        }
        return Map.of("uniqueIdentifier", code, "isActive", true, "data", data);
    }

    // ---- GET /providers/catalog ------------------------------------------

    @Test
    @SuppressWarnings("unchecked")
    void catalogListsTheFiveTypesWithTheirCredentialForms() throws Exception {
        Map<String, Object> out = controller.catalog().getBody();
        List<Object> data = (List<Object>) out.get("data");
        assertEquals(5, data.size());

        String json = mapper.writeValueAsString(out);
        for (String type : List.of("twilio-sms", "twilio-whatsapp", "smtp", "smscountry", "ozeki")) {
            assertTrue(json.contains("\"" + type + "\""), "catalog must offer " + type + ": " + json);
        }
        assertTrue(json.contains("\"credentialFields\""));
        assertTrue(json.contains("\"novuProviderId\""));
        assertTrue(json.contains("\"transport\""));
    }

    // ---- POST /providers, catalog form -----------------------------------

    @Test
    void twilioSmsCreate_mapsToTheTwilioProviderOnTheSmsChannel() {
        stubCreate(Map.of("_id", "i1", "providerId", "twilio", "channel", "sms"));

        controller.createProvider(Map.of("type", "twilio-sms", "name", "Gov SMS",
                "credentials", Map.of("accountSid", "ACxx", "token", "tok", "from", "+15550100")));

        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map> credentials = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).createIntegration(eq("Gov SMS"), identifier.capture(), eq("twilio"), eq("sms"),
                credentials.capture(), eq(true));
        assertEquals("twilio-sms", ProviderCatalog.typeFromIdentifier(identifier.getValue()));
        assertEquals("ACxx", credentials.getValue().get("accountSid"));
    }

    @Test
    void twilioWhatsappCreate_usesNovusSmsChannel_andAWhatsappMarkedIdentifier() {
        stubCreate(Map.of("_id", "i2", "providerId", "twilio", "channel", "sms"));

        controller.createProvider(Map.of("type", "twilio-whatsapp", "name", "Gov WhatsApp",
                "credentials", Map.of("accountSid", "ACxx", "token", "tok", "from", "whatsapp:+14155238886")));

        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        verify(novuClient).createIntegration(anyString(), identifier.capture(), eq("twilio"), eq("sms"),
                anyMap(), eq(true));
        assertEquals("twilio-whatsapp", ProviderCatalog.typeFromIdentifier(identifier.getValue()));
    }

    @Test
    void smtpCreate_mapsToNodemailerOnTheEmailChannel_withPortAsAString() {
        stubCreate(Map.of("_id", "i3", "providerId", "nodemailer", "channel", "email"));

        controller.createProvider(Map.of("type", "smtp", "name", "City Mail",
                "credentials", Map.of("host", "smtp.example.org", "port", "587", "user", "u",
                        "password", "p", "from", "no-reply@example.org", "senderName", "Desk",
                        "secure", false)));

        ArgumentCaptor<Map> credentials = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).createIntegration(eq("City Mail"), anyString(), eq("nodemailer"), eq("email"),
                credentials.capture(), eq(true));
        assertEquals("587", credentials.getValue().get("port"));
        assertEquals(Boolean.FALSE, credentials.getValue().get("secure"));
    }

    @Test
    void smsCountryCreate_buildsAGenericSmsIntegrationPointedAtTheBridgeAdapter() {
        stubCreate(Map.of("_id", "i4", "providerId", "generic-sms", "channel", "sms"));

        controller.createProvider(Map.of("type", "smscountry", "name", "KE SMSCountry",
                "credentials", Map.of("user", "panel-user", "password", "panel-pass", "senderId", "KE-GOV")));

        ArgumentCaptor<Map> credentials = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        verify(novuClient).createIntegration(eq("KE SMSCountry"), identifier.capture(),
                eq("generic-sms"), eq("sms"), credentials.capture(), eq(true));

        assertEquals("smscountry", ProviderCatalog.typeFromIdentifier(identifier.getValue()));
        Map<String, Object> creds = credentials.getValue();
        assertEquals(ADAPTER_URL, creds.get("baseUrl"));
        assertEquals("panel-user", creds.get("apiKey"));
        assertEquals("X-SMSCountry-User", creds.get("apiKeyRequestHeader"));
        assertEquals("panel-pass", creds.get("secretKey"));
        assertEquals("X-SMSCountry-Password", creds.get("secretKeyRequestHeader"));
        assertEquals("KE-GOV", creds.get("from"));
    }

    @Test
    void ozekiCreate_keepsItsOwnGatewayUrl() {
        stubCreate(Map.of("_id", "i5", "providerId", "generic-sms", "channel", "sms"));

        controller.createProvider(Map.of("type", "ozeki", "name", "Ozeki box",
                "credentials", Map.of("baseUrl", "https://ozeki.test:9509/api?action=sendmessage",
                        "username", "ozuser", "password", "ozpass")));

        ArgumentCaptor<Map> credentials = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> identifier = ArgumentCaptor.forClass(String.class);
        verify(novuClient).createIntegration(anyString(), identifier.capture(), eq("generic-sms"), eq("sms"),
                credentials.capture(), eq(true));
        assertEquals("ozeki", ProviderCatalog.typeFromIdentifier(identifier.getValue()));
        assertEquals("https://ozeki.test:9509/api?action=sendmessage", credentials.getValue().get("baseUrl"));
    }

    @Test
    void createHonoursAnExplicitInactiveFlag() {
        stubCreate(Map.of("_id", "i6"));
        controller.createProvider(Map.of("type", "twilio-sms", "name", "Staged",
                "active", false,
                "credentials", Map.of("accountSid", "AC", "token", "t", "from", "+1")));
        verify(novuClient).createIntegration(anyString(), anyString(), anyString(), anyString(),
                anyMap(), eq(false));
    }

    @Test
    void createRefusesAMissingRequiredCredential_beforeCallingNovu() {
        CustomException e = assertThrows(CustomException.class, () -> controller.createProvider(
                Map.of("type", "smscountry", "name", "Half done", "credentials", Map.of("user", "u"))));
        assertEquals("NB_INVALID_PROVIDER", e.getCode());
        verify(novuClient, never()).createIntegration(anyString(), anyString(), anyString(), anyString(),
                anyMap(), anyBoolean());
    }

    @Test
    void createRefusesAnUnknownType() {
        CustomException e = assertThrows(CustomException.class, () -> controller.createProvider(
                Map.of("type", "sendgrid", "name", "x", "credentials", Map.of())));
        assertEquals("NB_UNKNOWN_PROVIDER_TYPE", e.getCode());
    }

    @Test
    void createResponseNeverEchoesCredentials() throws Exception {
        Map<String, Object> created = new LinkedHashMap<>(Map.of("_id", "i7", "providerId", "generic-sms",
                "channel", "sms", "identifier", "smscountry-abcdef01"));
        created.put("credentials", Map.of("secretKey", "SECRET"));
        stubCreate(created);

        ProviderCreateResponse body = controller.createProvider(Map.of("type", "smscountry", "name", "n",
                "credentials", Map.of("user", "SECRET", "password", "SECRET", "senderId", "S"))).getBody();

        assertFalse(body.getData().containsKey("credentials"));
        assertEquals("smscountry", body.getData().get("type"), "the list projection must carry the type back");
        assertFalse(mapper.writeValueAsString(body).contains("SECRET"));
    }

    @Test
    void legacyBodyStillWorksUnchanged() {
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class)))
                .thenReturn(novuResp(201, Map.of("data", Map.of("_id", "legacy-1", "providerId", "twilio"))));

        controller.createProvider(Map.of("channel", "SMS", "providerId", "twilio", "name", "Legacy",
                "credentials", Map.of("accountSid", "AC")));

        // The five-argument overload — the one with no `active` — is the legacy path.
        verify(novuClient).createIntegration(eq("Legacy"), nullable(String.class), eq("twilio"), eq("sms"),
                anyMap());
        verify(novuClient, never()).createIntegration(anyString(), anyString(), anyString(), anyString(),
                anyMap(), anyBoolean());
    }

    // ---- POST /providers/_update -----------------------------------------

    @Test
    void updateRotatesCredentials_replacingTheWholeSet() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "smtp-deadbeef", "providerId", "nodemailer",
                "channel", "email", "name", "City Mail"));
        when(novuClient.updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class)))
                .thenReturn(novuResp(200, Map.of("data", Map.of("_id", "i1", "identifier", "smtp-deadbeef",
                        "providerId", "nodemailer", "channel", "email", "active", true))));

        Map<String, Object> rotated = Map.of("host", "smtp2.example.org", "port", "465", "user", "u2",
                "password", "new-pass", "from", "no-reply@example.org", "senderName", "Desk", "secure", true);
        ProviderCreateResponse body = controller.updateProvider(
                Map.of("id", "i1", "credentials", rotated)).getBody();

        ArgumentCaptor<Map> credentials = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).updateIntegration(eq("i1"), isNull(), credentials.capture(), isNull());
        assertEquals("smtp2.example.org", credentials.getValue().get("host"));
        assertEquals("465", credentials.getValue().get("port"));
        assertEquals("smtp", body.getData().get("type"));
        assertFalse(body.getData().containsKey("credentials"));
    }

    @Test
    void updateValidatesRequiredFieldsOnRotation_becauseNovuReplacesRatherThanMerges() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "smtp-deadbeef", "providerId", "nodemailer",
                "channel", "email"));

        CustomException e = assertThrows(CustomException.class, () -> controller.updateProvider(
                Map.of("id", "i1", "credentials", Map.of("password", "only-the-password"))));
        assertEquals("NB_INVALID_PROVIDER", e.getCode());
        assertTrue(e.getMessage().contains("host"), e.getMessage());
        verify(novuClient, never()).updateIntegration(anyString(), anyString(), anyMap(), any());
    }

    @Test
    void updateCanRenameOrToggleWithoutTouchingCredentials() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "twilio-sms-aaaa", "providerId", "twilio",
                "channel", "sms"));
        when(novuClient.updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class)))
                .thenReturn(novuResp(200, Map.of("data", Map.of("_id", "i1", "active", false))));

        controller.updateProvider(Map.of("id", "i1", "name", "Renamed", "active", false));

        verify(novuClient).updateIntegration(eq("i1"), eq("Renamed"), isNull(), eq(Boolean.FALSE));
    }

    @Test
    void updateWithNothingToChangeIsRefusedHere_notByNovu() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "twilio-sms-aaaa", "providerId", "twilio",
                "channel", "sms"));
        CustomException e = assertThrows(CustomException.class,
                () -> controller.updateProvider(Map.of("id", "i1")));
        assertEquals("NB_INVALID_PROVIDER", e.getCode());
    }

    @Test
    void updateOfAnUnknownIdIsNotFound() {
        stubIntegrations();
        CustomException e = assertThrows(CustomException.class,
                () -> controller.updateProvider(Map.of("id", "nope", "name", "x")));
        assertEquals("NB_PROVIDER_NOT_FOUND", e.getCode());
    }

    @Test
    void rotationRefusesWhenTheTypeCannotBeDerived() {
        // A hand-made generic-sms integration could be SMSCountry or Ozeki; mapping its
        // credentials on a guess would silently point it at the wrong gateway.
        stubIntegrations(Map.of("_id", "i9", "identifier", "hand-made", "providerId", "generic-sms",
                "channel", "sms"));
        CustomException e = assertThrows(CustomException.class, () -> controller.updateProvider(
                Map.of("id", "i9", "credentials", Map.of("user", "u", "password", "p", "senderId", "S"))));
        assertEquals("NB_UNKNOWN_PROVIDER_TYPE", e.getCode());
    }

    @Test
    void updateResolvesByIdentifierToo_butSendsNovuTheMongoId() {
        stubIntegrations(Map.of("_id", "mongo-1", "identifier", "twilio-sms-aaaa", "providerId", "twilio",
                "channel", "sms"));
        when(novuClient.updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class))).thenReturn(novuResp(200, Map.of("data", Map.of("_id", "mongo-1"))));

        controller.updateProvider(Map.of("id", "twilio-sms-aaaa", "name", "Renamed"));

        verify(novuClient).updateIntegration(eq("mongo-1"), eq("Renamed"), isNull(), isNull());
    }

    // ---- POST /providers/_delete -----------------------------------------

    @Test
    void deleteRemovesAProviderNoTenantIsUsing() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "smscountry-abcd", "providerId", "generic-sms",
                "channel", "sms"));
        stubChannelRows(channelRow("SMS", "twilio-sms-other"));
        when(novuClient.deleteIntegration(anyString())).thenReturn(novuResp(200, Map.of("data", List.of())));

        ResponseEntity<Map<String, Object>> response =
                controller.deleteProvider(Map.of("id", "i1", "tenantId", "ke.bomet"));

        assertEquals(200, response.getStatusCode().value());
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
        assertEquals("i1", data.get("id"));
        assertEquals(true, data.get("deleted"));
        verify(novuClient).deleteIntegration("i1");
    }

    @Test
    void deleteIsRefusedWith409WhenATenantStillRoutesThroughIt() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "smscountry-abcd", "providerId", "generic-sms",
                "channel", "sms"));
        stubChannelRows(channelRow("SMS", "smscountry-abcd"));

        ResponseEntity<Map<String, Object>> response =
                controller.deleteProvider(Map.of("id", "i1", "tenantId", "ke.bomet"));

        assertEquals(409, response.getStatusCode().value());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> errors = (List<Map<String, Object>>) response.getBody().get("Errors");
        assertEquals("NB_PROVIDER_IN_USE", errors.get(0).get("code"));
        // Novu must not have been touched: it would delete it without complaint and every SMS
        // on that tenant would start failing with no active integration.
        verify(novuClient, never()).deleteIntegration(anyString());
    }

    @Test
    void deleteWithoutATenantStillRefusesAProviderAnAlreadySeenTenantUses() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "ozeki-abcd", "providerId", "generic-sms",
                "channel", "sms"));
        stubChannelRows(channelRow("SMS", "ozeki-abcd"));
        policy.provider("mz", "SMS");   // warm the cache the way a live dispatch would

        ResponseEntity<Map<String, Object>> response = controller.deleteProvider(Map.of("id", "i1"));

        assertEquals(409, response.getStatusCode().value());
        verify(novuClient, never()).deleteIntegration(anyString());
    }

    @Test
    void deleteOfAnUnknownIdIsNotFound() {
        stubIntegrations();
        CustomException e = assertThrows(CustomException.class,
                () -> controller.deleteProvider(Map.of("id", "nope")));
        assertEquals("NB_PROVIDER_NOT_FOUND", e.getCode());
    }

    @Test
    void deleteWithoutAnIdIsRefused() {
        assertEquals("NB_INVALID_PROVIDER", assertThrows(CustomException.class,
                () -> controller.deleteProvider(Map.of())).getCode());
    }

    // ---- verify / test-send by type and id -------------------------------

    @Test
    void verifyCanMatchByCatalogType() {
        stubIntegrations(
                Map.of("_id", "i1", "identifier", "twilio-sms-aaaa", "providerId", "twilio",
                        "channel", "sms", "active", false),
                Map.of("_id", "i2", "identifier", "smtp-bbbb", "providerId", "nodemailer",
                        "channel", "email", "active", true));

        assertEquals(true, controller.verify(Map.of("type", "smtp")).getBody().get("ok"));
        assertEquals(false, controller.verify(Map.of("type", "twilio-sms")).getBody().get("ok"));
        assertEquals("no matching integration found",
                controller.verify(Map.of("type", "ozeki")).getBody().get("detail"));
    }

    @Test
    void testSendPinsTheNamedIntegration() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "smscountry-abcd", "providerId", "generic-sms",
                "channel", "sms", "active", true));
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class), anyMap(),
                anyString(), nullable(Map.class), nullable(String.class)))
                .thenReturn(novuResp(201, Map.of("acknowledged", true)));

        Map<String, Object> out = controller.testSend(Map.of("id", "i1", "channel", "SMS",
                "to", Map.of("phone", "+254712345678"), "body", "hello")).getBody();
        assertEquals(true, out.get("ok"));

        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), anyString(), anyMap(),
                anyString(), overrides.capture(), isNull());
        @SuppressWarnings("unchecked")
        Map<String, Object> sms = (Map<String, Object>) overrides.getValue().get("sms");
        assertEquals("smscountry-abcd", sms.get("integrationIdentifier"),
                "a test of one provider must be pinned to it, not to whatever is primary");
    }

    @Test
    void testSendForAnOzekiIntegrationCarriesTheGatewayBody() {
        stubIntegrations(Map.of("_id", "i1", "identifier", "ozeki-abcd", "providerId", "generic-sms",
                "channel", "sms", "active", true));
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class), anyMap(),
                anyString(), nullable(Map.class), nullable(String.class)))
                .thenReturn(novuResp(201, Map.of()));

        controller.testSend(Map.of("id", "i1", "channel", "SMS",
                "to", Map.of("phone", "+254712345678"), "body", "hello"));

        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).trigger(anyString(), anyString(), anyString(), anyMap(), anyString(),
                overrides.capture(), isNull());
        @SuppressWarnings("unchecked")
        Map<String, Object> providers = (Map<String, Object>) overrides.getValue().get("providers");
        // Keyed by the Novu PROVIDER ID; a key of "ozeki" would be silently ignored.
        assertTrue(providers.containsKey("generic-sms"), "Ozeki needs its own request body: " + providers);
    }

    @Test
    void testSendDerivesTheChannelFromTheCatalogTypeWhenNoneIsGiven() {
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString()))
                .thenReturn(novuResp(201, Map.of()));

        controller.testSend(Map.of("type", "smtp", "to", Map.of("email", "ops@example.org"),
                "subject", "s", "body", "b"));

        verify(novuClient).trigger(eq("complaints-email"), anyString(), nullable(String.class),
                eq("ops@example.org"), anyMap(), anyString());
    }

    @Test
    void integrationListCarriesTypeActiveAndPrimaryOnEveryRow() {
        Map<String, Object> smsCountry = new LinkedHashMap<>(Map.of(
                "_id", "i1", "identifier", "smscountry-abcd", "providerId", "generic-sms", "channel", "sms"));
        smsCountry.put("credentials", Map.of("secretKey", "SECRET"));
        when(novuClient.listIntegrations()).thenReturn(novuResp(200, Map.of("data", List.of(
                smsCountry,
                Map.of("_id", "i2", "providerId", "generic-sms", "channel", "sms",
                        "identifier", "hand-made", "active", true, "primary", true)))));

        List<Map<String, Object>> rows = new IntegrationController(novuClient).integrations().getBody().getData();

        assertEquals("smscountry", rows.get(0).get("type"));
        assertEquals(false, rows.get(0).get("active"));
        assertEquals(false, rows.get(0).get("primary"));
        assertFalse(rows.get(0).containsKey("credentials"));
        // Unmarked generic-sms: honestly null rather than a guess between SMSCountry and Ozeki.
        assertNull(rows.get(1).get("type"));
        assertEquals(true, rows.get(1).get("active"));
        assertEquals(true, rows.get(1).get("primary"));
    }
}
