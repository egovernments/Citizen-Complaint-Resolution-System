package org.egov.identity.keycloak.sms;

import java.util.function.Function;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;

/**
 * Config ({@code digit-sms-sender} scope): {@code MAILPIT_URL} (e.g.
 * {@code http://mailpit:8025/mailpit}), optional {@code MAILPIT_USERNAME} /
 * {@code MAILPIT_PASSWORD} for Mailpit's own basic auth, and {@code ALLOW_DEV}.
 */
public class MailpitSmsSenderFactory implements DigitSmsSenderFactory {

    private MailpitSmsSender sender;

    @Override
    public DigitSmsSender create(KeycloakSession session) {
        if (sender == null) {
            throw new IllegalStateException("digit-sms-sender 'mailpit' is not the selected mode");
        }
        return sender;
    }

    @Override
    public void init(Config.Scope config) {
        Function<String, String> scope = SmsSenderSelection.keycloakScope();
        if (!SmsSenderSelection.MAILPIT.equals(SmsSenderSelection.selected(scope))) {
            return;
        }
        String url = scope.apply("mailpit-url");
        MailpitSmsSender.assertStartupAllowed(SmsSenderSelection.allowDev(scope), url);
        sender = new MailpitSmsSender(url, scope.apply("mailpit-username"), scope.apply("mailpit-password"),
                JsonPoster.http());
    }

    @Override
    public String getId() {
        return SmsSenderSelection.MAILPIT;
    }
}
