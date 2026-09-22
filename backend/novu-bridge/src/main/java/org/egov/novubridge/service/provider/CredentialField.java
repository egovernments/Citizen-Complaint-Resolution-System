package org.egov.novubridge.service.provider;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Builder;
import lombok.Value;

/**
 * One field of a provider's credential form; the configurator renders the form from these.
 * {@code key} is the operator-side key, not necessarily Novu's (see {@link ProviderCatalog#toNovuCredentials}).
 */
@Value
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CredentialField {

    /** Key in the request's {@code credentials} object. */
    String key;
    /** Human label for the form control. */
    String label;
    /** {@code text} | {@code password} | {@code checkbox} — how the SPA renders it. */
    String type;
    boolean required;
    /** Optional example value; omitted from JSON when absent. */
    String placeholder;
    /** Optional one-line hint; omitted from JSON when absent. */
    String help;

    static CredentialField text(String key, String label, boolean required, String placeholder, String help) {
        return CredentialField.builder().key(key).label(label).type("text")
                .required(required).placeholder(placeholder).help(help).build();
    }

    static CredentialField password(String key, String label, boolean required, String help) {
        return CredentialField.builder().key(key).label(label).type("password")
                .required(required).help(help).build();
    }

    static CredentialField checkbox(String key, String label, String help) {
        return CredentialField.builder().key(key).label(label).type("checkbox")
                .required(false).help(help).build();
    }
}
