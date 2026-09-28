package org.egov.identity.keycloak.auth;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.Locale;
import org.egov.identity.keycloak.otp.NoteStore;
import org.egov.identity.keycloak.otp.OtpChallenge;
import org.egov.identity.keycloak.phone.MobileValidation;
import org.egov.identity.keycloak.phone.TenantMobileValidationResolver;
import org.egov.identity.keycloak.ratelimit.SendRateLimiter;
import org.egov.identity.keycloak.sms.DigitSmsSender;
import org.egov.identity.keycloak.sms.SmsContext;
import org.egov.identity.keycloak.sms.SmsSendException;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.sessions.AuthenticationSessionModel;

/** Glue between the pure OTP/rate-limit classes and a Keycloak flow context. */
final class PhoneAuthSupport {

    /**
     * Keycloak copies unknown authorization-request parameters into client
     * notes with this prefix (AuthorizationEndpoint
     * .LOGIN_SESSION_NOTE_ADDITIONAL_REQ_PARAMS_PREFIX, 26.7.3). The BFF sends
     * {@code digit_tenant=<slug>}.
     */
    static final String TENANT_CLIENT_NOTE = "client_request_param_digit_tenant";
    static final String NOTE_NEW_USER = "digit.phone.newUser";
    static final String PURPOSE_LOGIN = "login_otp";

    // Contract message keys; the themes map them to the legacy DIGIT texts.
    static final String MSG_INVALID_PHONE = "digitInvalidPhone";
    static final String MSG_INVALID_OTP = "digitInvalidOtp";
    static final String MSG_OTP_EXPIRED = "digitOtpExpired";
    static final String MSG_TOO_MANY = "digitTooManyAttempts";
    static final String MSG_RESEND_TOO_SOON = "digitResendTooSoon";
    static final String MSG_SMS_FAILED = "digitSmsSendFailed";

    private static final Logger LOG = Logger.getLogger(PhoneAuthSupport.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    enum SendOutcome { SENT, RESEND_TOO_SOON, LIMITED, FAILED }

    private PhoneAuthSupport() {
    }

    static String tenantSlug(AuthenticationSessionModel authSession) {
        if (authSession == null) {
            return null;
        }
        String slug = authSession.getClientNote(TENANT_CLIENT_NOTE);
        return slug != null && TenantMobileValidationResolver.TENANT_SLUG.matcher(slug).matches() ? slug : null;
    }

    static MobileValidation mobileValidation(AuthenticationFlowContext context) {
        return PhoneOtpRuntime.get().resolver.resolve(tenantSlug(context.getAuthenticationSession()));
    }

    static OtpChallenge challenge(AuthenticationFlowContext context) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        NoteStore notes = new NoteStore() {
            @Override
            public String get(String name) {
                return authSession.getAuthNote(name);
            }

            @Override
            public void set(String name, String value) {
                authSession.setAuthNote(name, value);
            }

            @Override
            public void remove(String name) {
                authSession.removeAuthNote(name);
            }
        };
        // Attempt slots and single use are claimed in the cluster-wide
        // single-use store, not in the (per-request copy of the) notes.
        KeycloakSession session = context.getSession();
        OtpChallenge.ClaimStore claims = (key, lifespanSeconds) ->
                session.singleUseObjects().putIfAbsent(key, lifespanSeconds);
        return new OtpChallenge(notes, claims, PhoneOtpRuntime.get().settings, Clock.systemUTC(), RANDOM);
    }

    /** Rate-limit, mint a new code and send it to {@code e164}. */
    static SendOutcome sendNewCode(AuthenticationFlowContext context, String e164) {
        PhoneOtpRuntime runtime = PhoneOtpRuntime.get();
        KeycloakSession session = context.getSession();
        RealmModel realm = context.getRealm();
        SendRateLimiter.SlotStore slots = new SendRateLimiter.SlotStore() {
            @Override
            public boolean putIfAbsent(String key, long lifespanSeconds) {
                return session.singleUseObjects().putIfAbsent(key, lifespanSeconds);
            }

            @Override
            public boolean contains(String key) {
                return session.singleUseObjects().contains(key);
            }
        };
        SendRateLimiter limiter = new SendRateLimiter(
                slots, runtime.settings, Clock.systemUTC(), realm.getId());
        String ip = context.getConnection() == null ? null : context.getConnection().getRemoteAddr();
        switch (limiter.tryAcquire(e164, ip)) {
            case RESEND_TOO_SOON:
                return SendOutcome.RESEND_TOO_SOON;
            case PHONE_LIMIT:
            case IP_LIMIT:
                return SendOutcome.LIMITED;
            default:
                break;
        }
        OtpChallenge challenge = challenge(context);
        String code = challenge.issue(e164);
        String tenant = tenantSlug(context.getAuthenticationSession());
        Locale locale = session.getContext().resolveLocale(null);
        String text = smsText(context, code, runtime.settings.otpTtl().toMinutes());
        DigitSmsSender sender = session.getProvider(DigitSmsSender.class, runtime.smsSenderId);
        try {
            if (sender == null) {
                throw new SmsSendException("no digit-sms-sender provider '" + runtime.smsSenderId + "'");
            }
            sender.send(e164, text, new SmsContext(realm.getName(), tenant,
                    locale == null ? null : locale.toLanguageTag(), PURPOSE_LOGIN));
            return SendOutcome.SENT;
        } catch (SmsSendException e) {
            LOG.warnf("OTP SMS send failed (realm=%s tenant=%s): %s", realm.getName(), tenant, e.getMessage());
            challenge.clearCode();
            return SendOutcome.FAILED;
        }
    }

    /**
     * SMS body from the login theme's {@code digitSmsOtpText} message
     * ({0} = code, {1} = minutes), with an English fallback. The code comes
     * first so phones can offer it for autofill.
     */
    private static String smsText(AuthenticationFlowContext context, String code, long minutes) {
        String fallback = code + " is your verification code. It expires in " + minutes
                + " minutes. Do not share it with anyone.";
        try {
            String message = context.form().getMessage("digitSmsOtpText", code, Long.toString(minutes));
            if (message == null || message.isBlank() || message.equals("digitSmsOtpText") || !message.contains(code)) {
                return fallback;
            }
            return message;
        } catch (RuntimeException e) {
            return fallback;
        }
    }
}
