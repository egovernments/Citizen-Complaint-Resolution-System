package org.egov.novubridge.web.filters;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;

/**
 * Unit coverage for {@link KeycloakTokenValidator}. An RSA keypair is generated
 * in-test, RS256 JWTs are hand-crafted and signed, and the public key is preloaded
 * into the validator's JWKS cache by {@code kid} — so no network call is made.
 * Asserts: valid signature+exp+iss accepted; tampered signature, expired {@code exp},
 * wrong {@code iss}, and a foreign signing key are each rejected.
 */
class KeycloakTokenValidatorTest {

    private static final String KID = "test";
    private static final String ISS = "https://x/realms/ke";

    private KeyPair keyPair;
    private NovuBridgeConfiguration config;
    private KeycloakTokenValidator validator;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        keyPair = kpg.generateKeyPair();

        config = new NovuBridgeConfiguration();
        config.setKeycloakEnabled(true);
        config.setKeycloakIssuer(ISS);
        config.setKeycloakCertsUrl(""); // JWKS preloaded below — never fetched

        Map<String, RSAPublicKey> seed = Map.of(KID, (RSAPublicKey) keyPair.getPublic());
        validator = new KeycloakTokenValidator(mock(RestTemplate.class), config, seed);
    }

    private long farFuture() {
        return System.currentTimeMillis() / 1000L + 3600;
    }

    private long past() {
        return System.currentTimeMillis() / 1000L - 3600;
    }

    private String jwt(long expSeconds, String iss) throws Exception {
        return jwt(expSeconds, iss, keyPair.getPrivate(), false);
    }

    private String jwt(long expSeconds, String iss, PrivateKey signer, boolean tamper) throws Exception {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "RS256");
        header.put("kid", KID);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("exp", expSeconds);
        payload.put("iss", iss);
        payload.put("preferred_username", "citizen-x");
        payload.put("realm_access", Map.of("roles", List.of("CITIZEN", "default-roles-ke")));

        String h = b64.encodeToString(mapper.writeValueAsBytes(header));
        String p = b64.encodeToString(mapper.writeValueAsBytes(payload));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(signer);
        sig.update((h + "." + p).getBytes(StandardCharsets.US_ASCII));
        byte[] signature = sig.sign();
        if (tamper) {
            signature[signature.length - 1] ^= 0x01;
        }
        return h + "." + p + "." + b64.encodeToString(signature);
    }

    @Test
    void validSignatureExpIss_accepted() throws Exception {
        Map<String, Object> claims = validator.validate(jwt(farFuture(), ISS));
        assertNotNull(claims);
        assertEquals("citizen-x", claims.get("preferred_username"));
    }

    @Test
    void tamperedSignature_rejected() throws Exception {
        String token = jwt(farFuture(), ISS, keyPair.getPrivate(), true);
        assertNull(validator.validate(token));
    }

    @Test
    void expiredExp_rejected() throws Exception {
        assertNull(validator.validate(jwt(past(), ISS)));
    }

    @Test
    void wrongIssuer_whenConfigured_rejected() throws Exception {
        assertNull(validator.validate(jwt(farFuture(), "https://evil/realms/ke")));
    }

    @Test
    void foreignSigningKey_rejected() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair other = kpg.generateKeyPair();
        // Same kid ("test") so the cached (correct) public key is used, but the token
        // was signed by a different private key → signature verification must fail.
        assertNull(validator.validate(jwt(farFuture(), ISS, other.getPrivate(), false)));
    }

    @Test
    void notAJwt_rejected() {
        assertNull(validator.validate("not-a-jwt"));
        assertNull(validator.validate(null));
    }
}
