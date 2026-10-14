package org.egov.novubridge.service.account;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The tenant API key is never stored in clear, and a stored value only opens for its own tenant. */
class ApiKeyCipherTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef-current";
    private static final String OLD = "0123456789abcdef0123456789abcdef-previous";

    @Test
    void roundTrips_withoutTheKeyAppearingInTheStoredValue() {
        ApiKeyCipher cipher = new ApiKeyCipher(SECRET, null);
        String stored = cipher.encrypt("nv-api-key-acme-1234567890", "acme");
        assertFalse(stored.contains("nv-api-key"), stored);
        assertTrue(stored.startsWith("v1:" + cipher.currentKeyId() + ":"), stored);
        assertEquals("nv-api-key-acme-1234567890", cipher.decrypt(stored, "acme"));
    }

    @Test
    void eachEncryptionUsesAFreshIv() {
        ApiKeyCipher cipher = new ApiKeyCipher(SECRET, null);
        assertNotEquals(cipher.encrypt("same", "acme"), cipher.encrypt("same", "acme"));
    }

    @Test
    void aValueMovedOntoAnotherTenantsRow_doesNotDecrypt() {
        ApiKeyCipher cipher = new ApiKeyCipher(SECRET, null);
        String stored = cipher.encrypt("nv-key", "acme");
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> cipher.decrypt(stored, "globex"));
        assertTrue(e.getMessage().contains("globex"));
    }

    @Test
    void aTamperedValue_doesNotDecrypt() {
        ApiKeyCipher cipher = new ApiKeyCipher(SECRET, null);
        String stored = cipher.encrypt("nv-key", "acme");
        char last = stored.charAt(stored.length() - 2);
        String tampered = stored.substring(0, stored.length() - 2) + (last == 'A' ? 'B' : 'A') + stored.charAt(stored.length() - 1);
        assertThrows(IllegalArgumentException.class, () -> cipher.decrypt(tampered, "acme"));
    }

    @Test
    void duringARotation_thePreviousKeyStillDecrypts_butNeverEncrypts() {
        String writtenBefore = new ApiKeyCipher(OLD, null).encrypt("nv-key", "acme");
        ApiKeyCipher rotating = new ApiKeyCipher(SECRET, OLD);
        assertEquals("nv-key", rotating.decrypt(writtenBefore, "acme"));
        assertFalse(rotating.readableByCurrentKey(writtenBefore, "acme"), "the previous key's value is stored again");
        assertTrue(rotating.readableByCurrentKey(rotating.encrypt("nv-key", "acme"), "acme"));
    }

    @Test
    void onlyAValueTheCurrentKeyOpensForThisTenant_isCurrent() {
        ApiKeyCipher cipher = new ApiKeyCipher(SECRET, OLD);
        String current = cipher.encrypt("nv-key", "acme");
        assertTrue(cipher.readableByCurrentKey(current, "acme"));
        // A key this bridge does not have (rotated twice, a wrong _PREVIOUS): neither current nor previous.
        String unknown = new ApiKeyCipher("ffffffffffffffffffffffffffffffff-unknown", null).encrypt("nv-key", "acme");
        assertFalse(cipher.readableByCurrentKey(unknown, "acme"));
        // The current key id, but the value does not open: altered, or another tenant's.
        String altered = current.substring(0, current.length() - 4) + (current.endsWith("AAAA") ? "BBBB" : "AAAA");
        assertFalse(cipher.readableByCurrentKey(altered, "acme"));
        assertFalse(cipher.readableByCurrentKey(current, "globex"));
        assertFalse(cipher.readableByCurrentKey(null, "acme"));
        assertFalse(cipher.readableByCurrentKey("garbage", "acme"));
    }

    @Test
    void aValueFromAnUnknownKey_isRefusedWithItsKeyId() {
        String stored = new ApiKeyCipher(OLD, null).encrypt("nv-key", "acme");
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> new ApiKeyCipher(SECRET, null).decrypt(stored, "acme"));
        assertTrue(e.getMessage().contains("neither the current nor the previous"), e.getMessage());
    }

    @Test
    void aShortSecret_isRefused() {
        assertThrows(IllegalArgumentException.class, () -> new ApiKeyCipher("too-short", null));
        assertThrows(IllegalArgumentException.class, () -> new ApiKeyCipher("", null));
    }
}
