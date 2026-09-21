package org.egov.novubridge.web.controllers;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.SmsCountryClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The SMSCountry adapter: the JSON face Novu's generic-sms provider talks to.
 *
 * <p>Request/response expectations here mirror novuhq/novu v2.3.0 exactly — body
 * {@code {to, from, content, id, customData, sender}}, credentials as headers named by the
 * {@code apiKeyRequestHeader}/{@code secretKeyRequestHeader} credentials, a success body that
 * must carry something at {@code idPath}, and a NON-2xx for a rejection (axios throws, the
 * Novu worker records PROVIDER_ERROR). A 200 with an error body would be read as a successful
 * send by everything downstream, which is the failure mode this endpoint exists to avoid.
 */
class SmsCountryAdapterControllerTest {

    private RestTemplate restTemplate;
    private SmsCountryAdapterController controller;
    private ListAppender<ILoggingEvent> logs;
    private Logger rootLogger;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setSmsSenderId("ENVSID");
        controller = new SmsCountryAdapterController(new SmsCountryClient(restTemplate, config), config);

        rootLogger = (Logger) LoggerFactory.getLogger("org.egov.novubridge");
        rootLogger.setLevel(Level.DEBUG);
        logs = new ListAppender<>();
        logs.start();
        rootLogger.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        rootLogger.detachAppender(logs);
    }

    /** The body Novu v2.3.0's generic-sms provider actually POSTs. */
    private static Map<String, Object> novuBody() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("to", "+254712345678");
        body.put("from", "KE-GOV");
        body.put("content", "Your complaint PGR-001 was assigned");
        body.put("id", "novu-message-id-1");
        body.put("customData", Map.of());
        body.put("sender", "KE-GOV");
        return body;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stubGateway(String responseBody) {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(String.class)))
                .thenReturn((ResponseEntity) new ResponseEntity<>(responseBody, HttpStatus.OK));
    }

    // ---- happy path ------------------------------------------------------

    @Test
    @SuppressWarnings("unchecked")
    void translatesNovuJsonIntoTheFormPost_andAnswersWithIdAndDate() {
        stubGateway("OK:4689046446");

        ResponseEntity<Map<String, Object>> response =
                controller.send("panel-user", "panel-pass", null, novuBody());

        assertEquals(200, response.getStatusCode().value());
        // idPath=id / datePath=date: generic-sms reads both, and the worker records the step
        // FAILED unless `id` is truthy.
        assertEquals("4689046446", response.getBody().get("id"));
        assertTrue(response.getBody().get("date").toString().contains("T"), "date must be an ISO instant");

        ArgumentCaptor<HttpEntity> request = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(eq("http://api.smscountry.com/SMSCwebservice_bulk.aspx"),
                eq(HttpMethod.POST), request.capture(), eq(String.class));
        MultiValueMap<String, String> form = (MultiValueMap<String, String>) request.getValue().getBody();
        assertEquals("panel-user", form.getFirst("User"));
        assertEquals("panel-pass", form.getFirst("passwd"));
        // The gateway wants the country code with no leading '+'.
        assertEquals("254712345678", form.getFirst("mobilenumber"));
        assertEquals("Your complaint PGR-001 was assigned", form.getFirst("message"));
        // The sender id arrives in the generic-sms body's `from`, from the integration credential.
        assertEquals("KE-GOV", form.getFirst("sid"));
    }

    @Test
    void perIntegrationApiUrlOverridesTheConfiguredGateway() {
        stubGateway("OK:1");
        controller.send("u", "p", "https://alt.smscountry.test/send", novuBody());
        verify(restTemplate).exchange(eq("https://alt.smscountry.test/send"),
                eq(HttpMethod.POST), any(HttpEntity.class), eq(String.class));
    }

    @Test
    void aNonHttpApiUrlIsIgnoredRatherThanPostedTo() {
        stubGateway("OK:1");
        controller.send("u", "p", "file:///etc/passwd", novuBody());
        verify(restTemplate).exchange(eq("http://api.smscountry.com/SMSCwebservice_bulk.aspx"),
                eq(HttpMethod.POST), any(HttpEntity.class), eq(String.class));
    }

    @Test
    void senderFallsBackToTheEnvDefaultWhenTheIntegrationCarriesNone() {
        stubGateway("OK:1");
        Map<String, Object> body = novuBody();
        body.remove("from");
        body.remove("sender");
        controller.send("u", "p", null, body);

        ArgumentCaptor<HttpEntity> request = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(anyString(), eq(HttpMethod.POST), request.capture(), eq(String.class));
        @SuppressWarnings("unchecked")
        MultiValueMap<String, String> form = (MultiValueMap<String, String>) request.getValue().getBody();
        assertEquals("ENVSID", form.getFirst("sid"));
    }

    // ---- refusals --------------------------------------------------------

    @Test
    void missingCredentialHeaders_is401_andNothingIsSentToTheGateway() {
        // This path bypasses the DIGIT proxy auth filter (Novu holds no DIGIT token), so the
        // credential headers ARE the authentication.
        for (String[] creds : new String[][]{{null, "p"}, {"u", null}, {null, null}, {"", "p"}, {"u", "  "}}) {
            ResponseEntity<Map<String, Object>> response =
                    controller.send(creds[0], creds[1], null, novuBody());
            assertEquals(401, response.getStatusCode().value());
            assertEquals("NB_ADAPTER_UNAUTHENTICATED", response.getBody().get("error"));
        }
        verifyNoInteractions(restTemplate);
    }

    @Test
    void missingRecipientOrContent_is400() {
        Map<String, Object> noTo = novuBody();
        noTo.remove("to");
        assertEquals(400, controller.send("u", "p", null, noTo).getStatusCode().value());

        Map<String, Object> noContent = novuBody();
        noContent.remove("content");
        assertEquals(400, controller.send("u", "p", null, noContent).getStatusCode().value());

        assertEquals(400, controller.send("u", "p", null, null).getStatusCode().value());
        verifyNoInteractions(restTemplate);
    }

    @Test
    void gatewayRejection_isANon2xx_soNovuMarksTheMessageFailed() {
        // The real gateway answers HTTP 200 with an error string. Passing that on as a 200
        // would make Novu record a delivery for a message SMSCountry refused.
        stubGateway("Invalid Username or Password");

        ResponseEntity<Map<String, Object>> response = controller.send("u", "wrong", null, novuBody());

        assertEquals(502, response.getStatusCode().value());
        assertEquals("NB_SMSCOUNTRY_REJECTED", response.getBody().get("error"));
        assertFalse(response.getBody().containsKey("id"), "a rejection must not carry a job id");
    }

    @Test
    void gatewayUnreachable_isANon2xx() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(String.class)))
                .thenThrow(new org.springframework.web.client.ResourceAccessException("connect timed out"));

        ResponseEntity<Map<String, Object>> response = controller.send("u", "p", null, novuBody());
        assertEquals(502, response.getStatusCode().value());
        assertEquals("NB_SMSCOUNTRY_UNREACHABLE", response.getBody().get("error"));
    }

    // ---- no credential or PII leakage ------------------------------------

    @Test
    void neitherCredentialsNorFullPhoneNumbersAreEverLogged() {
        stubGateway("OK:4689046446");
        controller.send("panel-user", "sup3r-s3cret", null, novuBody());
        stubGateway("Invalid Username or Password");
        controller.send("panel-user", "sup3r-s3cret", null, novuBody());
        controller.send(null, null, null, novuBody());

        String written = logs.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .reduce("", (a, b) -> a + "\n" + b);
        assertFalse(written.contains("sup3r-s3cret"), "password leaked into the log: " + written);
        assertFalse(written.contains("panel-user"), "username leaked into the log: " + written);
        assertFalse(written.contains("254712345678"), "raw recipient leaked into the log: " + written);
        // The masked form is what should be there instead.
        assertTrue(written.contains("***678"), "recipient should appear masked: " + written);
    }

    @Test
    void queuedIsNeverReportedAsDelivered() {
        // SMSCountry returns OK for messages the operator later drops (an unregistered DLT
        // template). The response may claim acceptance and nothing more.
        stubGateway("OK:77");
        Map<String, Object> body = controller.send("u", "p", null, novuBody()).getBody();
        assertEquals(java.util.Set.of("id", "date"), body.keySet());
    }

    /** Sanity: the header names the catalog stores are the ones this endpoint reads. */
    @Test
    void headerNamesMatchWhatTheCatalogWritesIntoTheIntegration() {
        assertEquals("X-SMSCountry-User",
                org.egov.novubridge.service.provider.ProviderCatalog.SMSCOUNTRY_USER_HEADER);
        assertEquals("X-SMSCountry-Password",
                org.egov.novubridge.service.provider.ProviderCatalog.SMSCOUNTRY_PASSWORD_HEADER);
    }
}
