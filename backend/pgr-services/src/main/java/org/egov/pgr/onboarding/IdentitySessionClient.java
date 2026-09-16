package org.egov.pgr.onboarding;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@Component
public class IdentitySessionClient {

    private final RestTemplate restTemplate;
    private final String identityBffUrl;
    private final String workloadToken;

    public IdentitySessionClient(RestTemplate restTemplate,
                                 @Value("${pgr.onboarding.identity-bff.url:}") String identityBffUrl,
                                 @Value("${pgr.onboarding.identity-bff.token:}") String workloadToken) {
        this.restTemplate = restTemplate;
        this.identityBffUrl = identityBffUrl == null ? "" : identityBffUrl.replaceAll("/$", "");
        this.workloadToken = workloadToken;
    }

    @SuppressWarnings("unchecked")
    public OnboardingPrincipal introspect(String cookieHeader) {
        if (identityBffUrl.isBlank() || workloadToken == null || workloadToken.isBlank()) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Onboarding identity is not configured");
        }
        if (cookieHeader == null || cookieHeader.isBlank()) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,
                    "A valid identity session is required");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(workloadToken);
        headers.add(HttpHeaders.COOKIE, cookieHeader);
        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                    identityBffUrl + "/internal/identity/v1/sessions/_introspect",
                    HttpMethod.POST,
                    new HttpEntity<>(headers),
                    Map.class);
            Map<String, Object> body = response.getBody();
            Map<String, Object> identity = body == null ? null : (Map<String, Object>) body.get("identity");
            if (identity == null || identity.get("issuer") == null || identity.get("subject") == null) {
                throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,
                        "Identity session could not be resolved");
            }
            return new OnboardingPrincipal(
                    identity.get("issuer").toString(),
                    identity.get("subject").toString(),
                    stringValue(identity.get("email")),
                    stringValue(identity.get("name")));
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 401) {
                throw new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,
                        "Identity session could not be resolved");
            }
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Identity service is unavailable");
        } catch (RestClientException exception) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Identity service is unavailable");
        }
    }

    @SuppressWarnings("unchecked")
    public boolean identifierAvailable(String type, String value) {
        if (identityBffUrl.isBlank() || workloadToken == null || workloadToken.isBlank()) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Onboarding identity is not configured");
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(workloadToken);
        headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
        Map<String, Object> request = Map.of("type", type, "value", value);
        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                    identityBffUrl + "/internal/identity/v1/identifiers/_check",
                    HttpMethod.POST, new HttpEntity<>(request, headers), Map.class);
            Map<String, Object> body = response.getBody();
            return body != null && Boolean.TRUE.equals(body.get("available"));
        } catch (RestClientException exception) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Identity availability check is unavailable");
        }
    }

    private String stringValue(Object value) {
        return value == null ? null : value.toString();
    }
}
