package org.egov.identity.keycloak.auth;

import java.util.function.Function;
import org.egov.identity.keycloak.config.OtpSettings;
import org.egov.identity.keycloak.phone.TenantMobileValidationResolver;
import org.egov.identity.keycloak.sms.SmsSenderSelection;
import org.keycloak.Config;

/**
 * Per-node state shared by the three phone authenticators: settings, the
 * tenant mobile-validation cache and the selected SMS sender id. Initialised
 * once from Keycloak config (scopes {@code digit-phone-otp} and
 * {@code digit-sms-sender}).
 */
final class PhoneOtpRuntime {

    private static volatile PhoneOtpRuntime instance;

    final OtpSettings settings;
    final TenantMobileValidationResolver resolver;
    final String smsSenderId;
    final boolean allowDev;

    private PhoneOtpRuntime(OtpSettings settings, String smsSenderId, boolean allowDev) {
        this.settings = settings;
        this.resolver = TenantMobileValidationResolver.http(settings);
        this.smsSenderId = smsSenderId;
        this.allowDev = allowDev;
    }

    static PhoneOtpRuntime get() {
        PhoneOtpRuntime current = instance;
        if (current == null) {
            synchronized (PhoneOtpRuntime.class) {
                current = instance;
                if (current == null) {
                    Config.Scope otp = Config.scope(OtpSettings.SCOPE);
                    Function<String, String> sms = SmsSenderSelection.keycloakScope();
                    current = new PhoneOtpRuntime(OtpSettings.from(otp::get),
                            SmsSenderSelection.selected(sms), SmsSenderSelection.allowDev(sms));
                    instance = current;
                }
            }
        }
        return current;
    }
}
