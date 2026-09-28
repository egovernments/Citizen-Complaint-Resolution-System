package org.egov.identity.keycloak.auth;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.List;
import org.egov.identity.keycloak.otp.OtpChallenge;
import org.egov.identity.keycloak.phone.MobileValidation;
import org.egov.identity.keycloak.phone.PhoneNumbers;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ModelDuplicateException;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.services.messages.Messages;

/**
 * Step 2: verify the SMS code (or resend it), then find-or-create the
 * Keycloak user whose {@code phoneNumber} attribute is the verified number.
 *
 * <p>Citizen users are separate from employee users: a new user gets
 * username = the E.164 number, {@code phoneNumber} and
 * {@code phoneNumberVerified=true}. An existing account that merely has that
 * username but not the attribute is never adopted.
 */
public class DigitSmsOtpAuthenticator implements Authenticator {

    static final String TEMPLATE = "login-sms-otp.ftl";
    static final String ATTR_PHONE = "phoneNumber";
    static final String ATTR_PHONE_VERIFIED = "phoneNumberVerified";
    private static final Logger LOG = Logger.getLogger(DigitSmsOtpAuthenticator.class);

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        OtpChallenge challenge = PhoneAuthSupport.challenge(context);
        if (challenge.phone() == null) {
            context.resetFlow();
            return;
        }
        context.challenge(form(context, challenge, null));
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> params = context.getHttpRequest().getDecodedFormParameters();
        OtpChallenge challenge = PhoneAuthSupport.challenge(context);
        String phone = challenge.phone();
        if (phone == null) {
            context.resetFlow();
            return;
        }
        if ("true".equals(params.getFirst("resend"))) {
            String error = switch (PhoneAuthSupport.sendNewCode(context, phone)) {
                case SENT -> null;
                case RESEND_TOO_SOON -> PhoneAuthSupport.MSG_RESEND_TOO_SOON;
                case LIMITED -> PhoneAuthSupport.MSG_TOO_MANY;
                case FAILED -> PhoneAuthSupport.MSG_SMS_FAILED;
            };
            context.challenge(form(context, PhoneAuthSupport.challenge(context), error));
            return;
        }

        switch (challenge.verify(params.getFirst("otp"))) {
            case OK:
                break;
            case INVALID:
                context.getEvent().error(Errors.INVALID_USER_CREDENTIALS);
                context.challenge(form(context, challenge, PhoneAuthSupport.MSG_INVALID_OTP));
                return;
            case TOO_MANY_ATTEMPTS:
                context.getEvent().error(Errors.INVALID_USER_CREDENTIALS);
                context.challenge(form(context, challenge, PhoneAuthSupport.MSG_TOO_MANY));
                return;
            default:
                context.getEvent().error(Errors.EXPIRED_CODE);
                context.challenge(form(context, challenge, PhoneAuthSupport.MSG_OTP_EXPIRED));
                return;
        }

        UserModel user = findOrCreate(context, phone);
        if (user == null) {
            context.getEvent().error(Errors.USERNAME_IN_USE);
            context.failure(AuthenticationFlowError.INVALID_USER,
                    context.form().setError(Messages.INVALID_USER).createErrorPage(Response.Status.CONFLICT));
            return;
        }
        if (!user.isEnabled()) {
            context.getEvent().user(user).error(Errors.USER_DISABLED);
            context.failure(AuthenticationFlowError.USER_DISABLED,
                    context.form().setError(Messages.ACCOUNT_DISABLED).createErrorPage(Response.Status.FORBIDDEN));
            return;
        }
        context.setUser(user);
        context.success();
    }

    private UserModel findOrCreate(AuthenticationFlowContext context, String phone) {
        KeycloakSession session = context.getSession();
        RealmModel realm = context.getRealm();
        UserModel user = findByPhone(session, realm, phone);
        if (user == null) {
            UserModel sameUsername = session.users().getUserByUsername(realm, phone);
            if (sameUsername != null) {
                LOG.warnf("realm %s: username %s exists without a matching phoneNumber; refusing to adopt it",
                        realm.getName(), sameUsername.getId());
                return null;
            }
            try {
                user = session.users().addUser(realm, null, phone, true, false);
                user.setEnabled(true);
                user.setSingleAttribute(ATTR_PHONE, phone);
                context.getAuthenticationSession().setAuthNote(PhoneAuthSupport.NOTE_NEW_USER, "true");
                context.getEvent().detail("digit_phone_user_created", "true");
            } catch (ModelDuplicateException e) {
                // A parallel login created it first.
                user = findByPhone(session, realm, phone);
                if (user == null) {
                    return null;
                }
            }
        }
        if (!"true".equals(user.getFirstAttribute(ATTR_PHONE_VERIFIED))) {
            user.setSingleAttribute(ATTR_PHONE_VERIFIED, "true");
        }
        return user;
    }

    private static UserModel findByPhone(KeycloakSession session, RealmModel realm, String phone) {
        List<UserModel> matches = session.users()
                .searchForUserByUserAttributeStream(realm, ATTR_PHONE, phone)
                .filter(u -> phone.equals(u.getFirstAttribute(ATTR_PHONE)))
                .limit(2)
                .toList();
        if (matches.size() > 1) {
            LOG.errorf("realm %s: more than one user has the same phoneNumber; refusing phone login", realm.getName());
            return null;
        }
        return matches.isEmpty() ? null : matches.get(0);
    }

    private Response form(AuthenticationFlowContext context, OtpChallenge challenge, String error) {
        MobileValidation validation = PhoneAuthSupport.mobileValidation(context);
        PhoneOtpRuntime runtime = PhoneOtpRuntime.get();
        LoginFormsProvider form = context.form()
                .setAttribute("maskedPhoneNumber", PhoneNumbers.mask(challenge.phone(), validation.countryCode()))
                .setAttribute("resendAvailableInSeconds", challenge.resendAvailableInSeconds())
                .setAttribute("otpLength", runtime.settings.otpLength());
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
