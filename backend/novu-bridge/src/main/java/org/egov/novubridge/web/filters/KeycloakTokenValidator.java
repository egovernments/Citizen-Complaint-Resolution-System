package org.egov.novubridge.web.filters;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.springframework.web.client.RestTemplate;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Validates a Keycloak-issued RS256 JWT by verifying its signature against the
 * realm JWKS, plus {@code exp} (must be in the future) and — when configured —
 * {@code iss}. Used by {@link ProxyAuthFilter} as a fallback for deployments
 * running {@code authProvider=keycloak}, where the browser sends a Keycloak
 * access token that egov-user's {@code /user/_details} introspection rejects.
 *
 * <p><b>Authorization scope (important):</b> Keycloak tokens on this deployment
 * carry {@code CITIZEN} plus realm-default roles in {@code realm_access.roles};
 * they do NOT carry DIGIT employee roles (EMPLOYEE / PGR_LME). This validator
 * therefore only proves <em>authenticity</em> (signature + exp + iss) and accepts
 * any valid realm token — mirroring how other DIGIT services (e.g. mdms-v2) accept
 * the same token on this deployment. Restricting the KC path to employees would
 * require a Keycloak protocol mapper that injects DIGIT roles into the token, which
 * is out of scope here.
 *
 * <p>Uses only Jackson + {@code java.security.*} + {@link Base64#getUrlDecoder()} —
 * no JWT library dependency. Parsed public keys are cached by {@code kid} in a
 * {@link ConcurrentHashMap}; a cache miss triggers a single JWKS refetch.
 */
@Slf4j
public class KeycloakTokenValidator {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Base64.Decoder urlDecoder = Base64.getUrlDecoder();
    // kid -> parsed RSA public key from the Keycloak JWKS.
    private final ConcurrentHashMap<String, RSAPublicKey> keyCache = new ConcurrentHashMap<>();

    public KeycloakTokenValidator(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Package-private test seam: preload the JWKS key cache (by {@code kid}) so
     * {@link #validate(String)} never has to hit the network in unit tests.
     */
    KeycloakTokenValidator(RestTemplate restTemplate, NovuBridgeConfiguration config,
                           Map<String, RSAPublicKey> seedKeys) {
        this(restTemplate, config);
        if (seedKeys != null) {
            this.keyCache.putAll(seedKeys);
        }
    }

    /**
     * @return the decoded claims map when the token is an authentic, unexpired
     *         Keycloak JWT (and, when {@code novu.bridge.keycloak.issuer} is set,
     *         {@code iss} matches); {@code null} otherwise.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> validate(String token) {
        try {
            if (token == null) {
                return null;
            }
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                return null; // not a JWT (JWS compact serialisation is header.payload.signature)
            }

            Map<String, Object> header = mapper.readValue(urlDecoder.decode(parts[0]), Map.class);
            Map<String, Object> claims = mapper.readValue(urlDecoder.decode(parts[1]), Map.class);

            Object alg = header.get("alg");
            if (alg == null || !"RS256".equals(alg.toString())) {
                log.warn("Keycloak token rejected: unsupported alg {}", alg);
                return null;
            }

            // exp (epoch seconds) must be in the future.
            Object expObj = claims.get("exp");
            if (!(expObj instanceof Number)) {
                return null;
            }
            long expSeconds = ((Number) expObj).longValue();
            if (expSeconds <= System.currentTimeMillis() / 1000L) {
                log.warn("Keycloak token rejected: expired (exp={})", expSeconds);
                return null;
            }

            // iss must match when an issuer is configured.
            String expectedIss = config.getKeycloakIssuer();
            if (expectedIss != null && !expectedIss.isEmpty()) {
                Object iss = claims.get("iss");
                if (iss == null || !expectedIss.equals(iss.toString())) {
                    log.warn("Keycloak token rejected: issuer mismatch (got {}, expected {})", iss, expectedIss);
                    return null;
                }
            }

            Object kidObj = header.get("kid");
            String kid = kidObj == null ? null : kidObj.toString();
            RSAPublicKey key = resolveKey(kid);
            if (key == null) {
                log.warn("Keycloak token rejected: no JWKS key for kid {}", kid);
                return null;
            }

            byte[] signedData = (parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII);
            byte[] signature = urlDecoder.decode(parts[2]);
            Signature verifier = Signature.getInstance("SHA256withRSA");
            verifier.initVerify(key);
            verifier.update(signedData);
            if (!verifier.verify(signature)) {
                log.warn("Keycloak token rejected: signature verification failed (kid {})", kid);
                return null;
            }
            return claims;
        } catch (Exception e) {
            log.warn("Keycloak token rejected: validation error: {}", e.getMessage());
            return null;
        }
    }

    /** Resolve a public key by {@code kid}, refetching the JWKS once on a cache miss. */
    private RSAPublicKey resolveKey(String kid) {
        if (kid == null) {
            return null;
        }
        RSAPublicKey key = keyCache.get(kid);
        if (key != null) {
            return key;
        }
        refreshJwks();
        return keyCache.get(kid);
    }

    /** GET the Keycloak JWKS and (re)populate the key cache, keyed by {@code kid}. */
    @SuppressWarnings("unchecked")
    private synchronized void refreshJwks() {
        String url = config.getKeycloakCertsUrl();
        if (url == null || url.isEmpty()) {
            return;
        }
        try {
            Map<String, Object> jwks = restTemplate.getForObject(url, Map.class);
            if (jwks == null) {
                return;
            }
            Object keysObj = jwks.get("keys");
            if (!(keysObj instanceof List)) {
                return;
            }
            for (Object k : (List<Object>) keysObj) {
                if (!(k instanceof Map)) {
                    continue;
                }
                Map<String, Object> jwk = (Map<String, Object>) k;
                Object kty = jwk.get("kty");
                if (kty != null && !"RSA".equalsIgnoreCase(kty.toString())) {
                    continue;
                }
                Object jwkKid = jwk.get("kid");
                Object n = jwk.get("n");
                Object e = jwk.get("e");
                if (jwkKid == null || n == null || e == null) {
                    continue;
                }
                try {
                    keyCache.put(jwkKid.toString(), toRsaPublicKey(n.toString(), e.toString()));
                } catch (Exception ex) {
                    log.warn("Keycloak JWKS: failed to parse key kid {}: {}", jwkKid, ex.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("Keycloak JWKS: fetch failed from {}: {}", url, e.getMessage());
        }
    }

    /** Build an {@link RSAPublicKey} from the base64url JWK modulus ({@code n}) and exponent ({@code e}). */
    private RSAPublicKey toRsaPublicKey(String n, String e) throws Exception {
        BigInteger modulus = new BigInteger(1, urlDecoder.decode(n));
        BigInteger exponent = new BigInteger(1, urlDecoder.decode(e));
        return (RSAPublicKey) KeyFactory.getInstance("RSA")
                .generatePublic(new RSAPublicKeySpec(modulus, exponent));
    }
}
