package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SMSCountry's legacy API answers HTTP 200 whatever happens, so success is decided
 * entirely by the response body. Getting this wrong means the pipeline records a
 * delivery for a message the gateway refused.
 */
class SmsCountryClientTest {

    private static SmsCountryClient client() {
        return new SmsCountryClient(new RestTemplate(), new NovuBridgeConfiguration());
    }

    @Test
    void okWithAJobIdIsTheOnlyAcceptedResponse() {
        NovuClient.NovuResponse r = client().parse("OK:4689046446", "txn-1", "+919000000000");
        assertEquals(200, r.getStatusCode());
        assertEquals("4689046446", r.getResponse().get("jobId"));
    }

    @Test
    void surroundingWhitespaceDoesNotHideTheJobId() {
        NovuClient.NovuResponse r = client().parse("  OK:123 \n", "txn-1", "+919000000000");
        assertEquals(200, r.getStatusCode());
        assertEquals("123", r.getResponse().get("jobId"));
    }

    @Test
    void anythingElseIsAFailureEvenThoughTheGatewayReturnedHttp200() {
        // The real gateway answers 200 with an ASP.NET stack trace when a required
        // parameter is missing, and 200 with an error string on bad credentials.
        for (String body : new String[]{
                "", "   ", null,
                "System.ArgumentNullException: Value cannot be null.",
                "<!DOCTYPE html><html>...</html>",
                "Invalid Username or Password"}) {
            NovuClient.NovuResponse r = client().parse(body, "txn-1", "+919000000000");
            assertEquals(502, r.getStatusCode(), "should have failed for: " + body);
            assertEquals("NB_SMSCOUNTRY_REJECTED", r.getResponse().get("error"));
        }
    }

    @Test
    void aVeryLongErrorBodyIsTruncatedBeforeItReachesTheDispatchLog() {
        NovuClient.NovuResponse r = client().parse("x".repeat(5000), "txn-1", "+919000000000");
        String message = String.valueOf(r.getResponse().get("message"));
        assertTrue(message.length() < 250, "stack traces must not be stored whole");
        assertTrue(message.endsWith("…"));
    }

    @Test
    void acceptedIsRecordedAsQueuedNotDelivered() {
        // The gateway returns OK for messages the operator later drops (an
        // unregistered DLT template). Nothing here may claim delivery.
        NovuClient.NovuResponse r = client().parse("OK:1", "txn-1", "+919000000000");
        assertTrue((Boolean) r.getResponse().get("accepted"));
        assertFalse(r.getResponse().containsKey("delivered"));
    }
}
