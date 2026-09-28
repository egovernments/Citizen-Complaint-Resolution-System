package org.egov.identity.keycloak.forms;

import jakarta.ws.rs.core.UriBuilder;
import java.util.Locale;
import java.util.Properties;
import java.util.regex.Pattern;
import org.keycloak.forms.login.LoginFormsPages;
import org.keycloak.forms.login.freemarker.FreeMarkerLoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.theme.Theme;

/**
 * The stock FreeMarker login forms plus one attribute on every page:
 * {@code digitTenant}, the route tenant slug the BFF passed to the
 * authorization request as {@code digit_tenant}. Keycloak stores unknown
 * authorization parameters as client notes prefixed {@code client_request_param_}.
 * The value is display-only (branding); anything not a plain slug is dropped.
 */
public class DigitLoginFormsProvider extends FreeMarkerLoginFormsProvider {

    public static final String ATTRIBUTE = "digitTenant";
    public static final String CLIENT_NOTE = "client_request_param_digit_tenant";
    static final Pattern SLUG = Pattern.compile("^[a-z0-9-]{2,63}$");

    public DigitLoginFormsProvider(KeycloakSession session) {
        super(session);
    }

    @Override
    protected void createCommonAttributes(Theme theme, Locale locale, Properties messagesBundle,
            UriBuilder baseUriBuilder, LoginFormsPages page) {
        super.createCommonAttributes(theme, locale, messagesBundle, baseUriBuilder, page);
        String tenant = validSlug(authenticationSession == null ? null : authenticationSession.getClientNote(CLIENT_NOTE));
        if (tenant != null) {
            attributes.put(ATTRIBUTE, tenant);
        } else {
            attributes.remove(ATTRIBUTE);
        }
    }

    public static String validSlug(String value) {
        return value != null && SLUG.matcher(value).matches() ? value : null;
    }
}
