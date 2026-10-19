package org.egov.pgr.onboarding;

import org.junit.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** Review #2024, finding 6: a rejected workload credential is a deployment fault, not a login problem. */
public class IdentitySessionClientTest {

    private static final String INTROSPECT = "https://bff/internal/identity/v1/sessions/_introspect";
    private static final String CHECK = "https://bff/internal/identity/v1/identifiers/_check";

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    private final IdentitySessionClient client =
            new IdentitySessionClient(restTemplate, "https://bff/", "workload-token");

    @Test
    public void anExpiredUserSessionStaysA401() {
        server.expect(requestTo(INTROSPECT)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        // The workload-only probe is accepted, so only the user's session was refused.
        server.expect(requestTo(CHECK))
                .andRespond(withSuccess("{\"available\":true}", MediaType.APPLICATION_JSON));

        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> client.introspect("digit_identity_session=stale"));

        assertEquals(HttpStatus.UNAUTHORIZED, exception.getStatusCode());
        server.verify();
    }

    @Test
    public void aRejectedWorkloadTokenIsReportedAsUnavailableNotUnauthorized() {
        server.expect(requestTo(INTROSPECT)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        server.expect(requestTo(CHECK)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> client.introspect("digit_identity_session=valid"));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatusCode());
        server.verify();
    }

    @Test
    public void aMissingCookieNeverReachesTheBff() {
        ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> client.introspect(null));

        assertEquals(HttpStatus.UNAUTHORIZED, exception.getStatusCode());
        server.verify();
    }

    @Test
    public void introspectionIsTimeBoxedSoAHungBffCannotPinTomcatThreads() {
        // The autowired path wraps the shared template in one carrying timeouts.
        IdentitySessionClient configured = new IdentitySessionClient(
                new RestTemplate(), "https://bff", "workload-token", 250, 750);

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ResponseStatusException.class,
                () -> configured.introspect("digit_identity_session=x")).getStatusCode());
    }
}
