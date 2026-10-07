package org.egov.novubridge.service.account;

import org.springframework.util.StringUtils;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Encrypts a tenant's Novu API key at rest: AES-256-GCM, a random 96-bit IV per value, and the
 * root tenant id as additional authenticated data, so a ciphertext copied onto another tenant's
 * row does not decrypt. The AES key is SHA-256 of the configured secret (any long random string,
 * the way the deploy generates its other secrets).
 *
 * <p>Stored form: {@code v1:<kid>:<base64(iv || ciphertext+tag)>}, where {@code kid} is the first
 * 8 hex characters of SHA-256 of the AES key: it says which key wrote a value, so a rotation can
 * keep the previous key for reading while every new value uses the current one.
 */
public final class ApiKeyCipher {

    private static final String PREFIX = "v1";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    /** Shorter secrets are refused: the key is only as strong as what it is derived from. */
    public static final int MIN_SECRET_LENGTH = 32;

    private final SecretKeySpec current;
    private final String currentKid;
    private final SecretKeySpec previous;
    private final String previousKid;
    private final SecureRandom random = new SecureRandom();

    public ApiKeyCipher(String secret, String previousSecret) {
        if (!StringUtils.hasText(secret) || secret.trim().length() < MIN_SECRET_LENGTH) {
            throw new IllegalArgumentException("the tenant API-key encryption secret must be at least "
                    + MIN_SECRET_LENGTH + " characters");
        }
        this.current = derive(secret.trim());
        this.currentKid = kid(current);
        if (StringUtils.hasText(previousSecret)) {
            this.previous = derive(previousSecret.trim());
            this.previousKid = kid(previous);
        } else {
            this.previous = null;
            this.previousKid = null;
        }
    }

    public String encrypt(String plaintext, String tenantRoot) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, current, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad(tenantRoot));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            return PREFIX + ":" + currentKid + ":" + Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("AES-GCM is mandatory on every JVM", e);
        }
    }

    /** @throws IllegalArgumentException when the value is malformed, written by an unknown key, or tampered with */
    public String decrypt(String stored, String tenantRoot) {
        if (!StringUtils.hasText(stored)) {
            throw new IllegalArgumentException("no stored value");
        }
        String[] parts = stored.split(":", 3);
        if (parts.length != 3 || !PREFIX.equals(parts[0])) {
            throw new IllegalArgumentException("unknown stored-key format");
        }
        SecretKeySpec key;
        if (parts[1].equals(currentKid)) {
            key = current;
        } else if (previous != null && parts[1].equals(previousKid)) {
            key = previous;
        } else {
            throw new IllegalArgumentException("stored key was encrypted with key id " + parts[1]
                    + ", which is neither the current nor the previous encryption key");
        }
        try {
            byte[] raw = Base64.getDecoder().decode(parts[2]);
            if (raw.length <= IV_BYTES) {
                throw new IllegalArgumentException("stored value too short");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, raw, 0, IV_BYTES));
            cipher.updateAAD(aad(tenantRoot));
            return new String(cipher.doFinal(raw, IV_BYTES, raw.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalArgumentException("stored key does not decrypt for tenant " + tenantRoot
                    + " (wrong encryption key, or the value was altered or moved from another tenant)");
        }
    }

    /** Whether a stored value was written with the previous key (a re-encrypt candidate). */
    public boolean writtenByPreviousKey(String stored) {
        return previousKid != null && stored != null && stored.startsWith(PREFIX + ":" + previousKid + ":");
    }

    public String currentKeyId() {
        return currentKid;
    }

    private static byte[] aad(String tenantRoot) {
        return ("nb_tenant_account:" + tenantRoot).getBytes(StandardCharsets.UTF_8);
    }

    private static SecretKeySpec derive(String secret) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(digest, "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is mandatory on every JVM", e);
        }
    }

    private static String kid(SecretKeySpec key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getEncoded());
            return HexFormat.of().formatHex(digest).substring(0, 8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is mandatory on every JVM", e);
        }
    }
}
