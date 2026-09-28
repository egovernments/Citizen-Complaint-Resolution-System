package org.egov.identity.keycloak.auth;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.regex.Pattern;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.messages.Messages;

/**
 * Step 3, new citizens only: ask for a name (the legacy "Provide your name"
 * step). Skipped for any user who already has a first name, which also
 * covers a user created by a login that was abandoned at this step.
 */
public class DigitPhoneProfileAuthenticator implements Authenticator {

    static final String TEMPLATE = "login-phone-profile.ftl";
    static final int MAX_NAME_LENGTH = 100;
    /** Keycloak's own person-name rule (PersonNameProhibitedCharactersValidator). */
    static final Pattern PROHIBITED = Pattern.compile("[<>&\"\\v$%!#?§;*~/\\\\|^=\\[\\]{}()\\p{Cntrl}]");

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        UserModel user = context.getUser();
        if (user.getFirstName() != null && !user.getFirstName().isBlank()) {
            context.success();
            return;
        }
        context.challenge(form(context, null, null, null));
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> params = context.getHttpRequest().getDecodedFormParameters();
        String firstName = clean(params.getFirst("firstName"));
        String lastName = clean(params.getFirst("lastName"));
        String error = null;
        if (firstName == null) {
            error = Messages.MISSING_FIRST_NAME;
        } else if (!validName(firstName) || (lastName != null && !validName(lastName))) {
            error = "error-person-name-invalid-character";
        }
        if (error != null) {
            context.getEvent().error(Errors.INVALID_INPUT);
            context.challenge(form(context, error, params.getFirst("firstName"), params.getFirst("lastName")));
            return;
        }
        UserModel user = context.getUser();
        user.setFirstName(firstName);
        if (lastName != null) {
            user.setLastName(lastName);
        }
        context.success();
    }

    static String clean(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.strip().replaceAll("\\s+", " ");
        return trimmed.isEmpty() ? null : trimmed;
    }

    static boolean validName(String value) {
        return value.length() <= MAX_NAME_LENGTH && !PROHIBITED.matcher(value).find();
    }

    private Response form(AuthenticationFlowContext context, String error, String firstName, String lastName) {
        LoginFormsProvider form = context.form();
        if (firstName != null) {
            form.setAttribute("firstName", truncate(firstName));
        }
        if (lastName != null) {
            form.setAttribute("lastName", truncate(lastName));
        }
        if (error != null) {
            form.setError(error);
        }
        return form.createForm(TEMPLATE);
    }

    private static String truncate(String value) {
        return value.length() > MAX_NAME_LENGTH ? value.substring(0, MAX_NAME_LENGTH) : value;
    }

    @Override
    public boolean requiresUser() {
        return true;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }
}
