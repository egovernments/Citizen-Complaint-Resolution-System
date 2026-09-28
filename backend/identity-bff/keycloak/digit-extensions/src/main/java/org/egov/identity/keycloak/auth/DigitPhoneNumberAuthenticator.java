package org.egov.identity.keycloak.auth;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.Optional;
import org.egov.identity.keycloak.otp.OtpChallenge;
import org.egov.identity.keycloak.phone.MobileValidation;
import org.egov.identity.keycloak.phone.PhoneNumbers;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Step 1 of the citizen flow: collect a phone number, normalise it to E.164
 * against the route tenant's MobileNumberValidation, and send an OTP.
 *
 * <p>No user is looked up here. Every well-formed number gets the same
 * response ("code sent"), so the page cannot be used to learn which numbers
 * have accounts; the user is found or created only after the OTP is proven.
 */
public class DigitPhoneNumberAuthenticator implements Authenticator {

    static final String TEMPLATE = "login-phone-number.ftl";
    static final String FIELD = "phoneNumber";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        context.challenge(form(context, null, null));
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> params = context.getHttpRequest().getDecodedFormParameters();
        String raw = params.getFirst(FIELD);
        MobileValidation validation = PhoneAuthSupport.mobileValidation(context);
        Optional<String> e164 = PhoneNumbers.normalize(raw, validation);
        if (e164.isEmpty()) {
            context.getEvent().error(Errors.INVALID_INPUT);
            context.challenge(form(context, PhoneAuthSupport.MSG_INVALID_PHONE, raw));
            return;
        }
        String phone = e164.get();
        OtpChallenge challenge = PhoneAuthSupport.challenge(context);
        switch (PhoneAuthSupport.sendNewCode(context, phone)) {
            case SENT:
                context.success();
                return;
            case RESEND_TOO_SOON:
                // Back button / double submit: the code already sent to this
                // number in this session is still good, so just go on.
                if (phone.equals(challenge.phone()) && challenge.hasActiveCode()) {
                    context.success();
                } else {
                    context.challenge(form(context, PhoneAuthSupport.MSG_RESEND_TOO_SOON, raw));
                }
                return;
            case LIMITED:
                context.getEvent().error(Errors.ACCESS_DENIED);
                context.challenge(form(context, PhoneAuthSupport.MSG_TOO_MANY, raw));
                return;
            default:
                context.getEvent().error(Errors.EMAIL_SEND_FAILED);
                context.challenge(form(context, PhoneAuthSupport.MSG_SMS_FAILED, raw));
        }
    }

    private Response form(AuthenticationFlowContext context, String error, String value) {
        MobileValidation validation = PhoneAuthSupport.mobileValidation(context);
        LoginFormsProvider form = context.form()
                .setAttribute("countryCode", validation.countryCode())
                .setAttribute("mobileNumberRegex", validation.mobileNumberRegex());
        if (validation.errorMessage() != null) {
            form.setAttribute("mobileValidationErrorMessage", validation.errorMessage());
        }
        if (value != null) {
            form.setAttribute(FIELD, value.length() > 32 ? value.substring(0, 32) : value);
        }
        if (error != null) {
            form.setError(error);
        }
        return form.createForm(TEMPLATE);
    }

    @Override
    public boolean requiresUser() {
        return false;
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
