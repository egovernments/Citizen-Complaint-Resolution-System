package org.egov.pgr.onboarding;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.Map;

@Component
public class IdentitySessionClient {

    private static final String INTROSPECT = "/internal/identity/v1/sessions/_introspect";
    private static final String CHECK = "/internal/identity/v1/identifiers/_check";

    private final RestTemplate restTemplate;
    private final String identityBffUrl;
    private final String workloadToken;

    @Autowired
    public IdentitySessionClient(RestTemplate restTemplate,
                                 @Value("${pgr.onboarding.identity-bff.url:}") String identityBffUrl,
                                 @Value("${pgr.onboarding.identity-bff.token:}") String workloadToken,
                                 @Value("${pgr.onboarding.identity-bff.connect-timeout-ms:2000}") int connectTimeoutMs,
                                 @Value("${pgr.onboarding.identity-bff.read-timeout-ms:5000}") int readTimeoutMs) {
        this(timeBoxed(restTemplate, connectTimeoutMs, readTimeoutMs), identityBffUrl, workloadToken);
    }

    IdentitySessionClient(RestTemplate restTemplate, String identityBffUrl, String workloadToken) {
        this.restTemplate = restTemplate;
        this.identityBffUrl = identityBffUrl == null ? "" : identityBffUrl.replaceAll("/$", "");
        this.workloadToken = workloadToken;
    }

    /**
     * The shared RestTemplate has no timeouts. Onboarding calls the BFF on the request
     * thread, so a hung identity-bff would pin every Tomcat thread; this copy keeps the
     * application's converters but fails fast instead. The shared bean is left alone.
     */
    private static RestTemplate timeBoxed(RestTemplate shared, int connectTimeoutMs, int readTimeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(connectTimeoutMs));
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        RestTemplate scoped = new RestTemplate(shared.getMessageConverters());
        scoped.setRequestFactory(factory);
        return scoped;
    }

    @SuppressWarnings("unchecked")
    public OnboardingPrincipal introspect(String cookieHeader) {
        requireConfigured();
        if (cookieHeader == null || cookieHeader.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A valid identity session is required");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(workloadToken);
        headers.add(HttpHeaders.COOKIE, cookieHeader);
        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                    identityBffUrl + INTROSPECT, HttpMethod.POST, new HttpEntity<>(headers), Map.class);
            Map<String, Object> body = response.getBody();
            Map<String, Object> identity = body == null ? null : (Map<String, Object>) body.get("identity");
            if (identity == null || identity.get("issuer") == null || identity.get("subject") == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Identity session could not be resolved");
            }
            return new OnboardingPrincipal(
                    identity.get("issuer").toString(),
                    identity.get("subject").toString(),
                    stringValue(identity.get("email")),
                    stringValue(identity.get("name")));
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 401) throw unauthenticated();
            throw unavailable("Identity service is unavailable");
        } catch (RestClientException exception) {
            throw unavailable("Identity service is unavailable");
        }
    }

    @SuppressWarnings("unchecked")
    public boolean identifierAvailable(String type, String value) {
        requireConfigured();
        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                    identityBffUrl + CHECK, HttpMethod.POST, workloadRequest(type, value), Map.class);
            Map<String, Object> body = response.getBody();
            return body != null && Boolean.TRUE.equals(body.get("available"));
        } catch (RestClientException exception) {
            throw unavailable("Identity availability check is unavailable");
        }
    }

    /**
     * Introspection sends two credentials, so its 401 is ambiguous: a misconfigured
     * PGR_ONBOARDING_IDENTITY_BFF_TOKEN looks exactly like an expired user session.
     * This probe carries the workload token alone — if it is also refused, the
     * deployment is misconfigured and the honest answer is 503, not "please log in".
     */
    private ResponseStatusException unauthenticated() {
        try {
            restTemplate.exchange(identityBffUrl + CHECK, HttpMethod.POST,
                    workloadRequest("URL_SLUG", "workload-credential-probe"), Map.class);
        } catch (RestClientResponseException probe) {
            if (probe.getStatusCode().value() == 401) {
                return unavailable("Onboarding identity credentials are rejected");
            }
        } catch (RestClientException probe) {
            return unavailable("Identity service is unavailable");
        }
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Identity session could not be resolved");
    }

    private HttpEntity<Map<String, Object>> workloadRequest(String type, String value) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(workloadToken);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(Map.of("type", type, "value", value), headers);
    }

    private void requireConfigured() {
        if (identityBffUrl.isBlank() || workloadToken == null || workloadToken.isBlank()) {
            throw unavailable("Onboarding identity is not configured");
        }
    }

    private ResponseStatusException unavailable(String reason) {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, reason);
    }

    private String stringValue(Object value) {
        return value == null ? null : value.toString();
    }
}
