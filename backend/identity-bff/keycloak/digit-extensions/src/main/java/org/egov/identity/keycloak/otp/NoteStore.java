package org.egov.identity.keycloak.otp;

/** The auth-session notes an OTP challenge lives in (an adapter keeps this testable). */
public interface NoteStore {
    String get(String name);

    void set(String name, String value);

    void remove(String name);
}
