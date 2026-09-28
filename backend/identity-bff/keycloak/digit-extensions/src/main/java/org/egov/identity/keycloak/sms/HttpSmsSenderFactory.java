package org.egov.identity.keycloak.sms;

import java.util.function.Function;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;

/** Config ({@code digit-sms-sender} scope): {@code HTTP_URL}, {@code HTTP_TOKEN}. */
public class HttpSmsSenderFactory implements DigitSmsSenderFactory {

    private HttpSmsSender sender;

    @Override
    public DigitSmsSender create(KeycloakSession session) {
        if (sender == null) {
            throw new IllegalStateException("digit-sms-sender 'http' is not the selected mode");
        }
        return sender;
    }

    @Override
    public void init(Config.Scope config) {
        Function<String, String> scope = SmsSenderSelection.keycloakScope();
        if (!SmsSenderSelection.HTTP.equals(SmsSenderSelection.selected(scope))) {
            return;
        }
        String url = scope.apply("http-url");
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("digit-sms-sender mode 'http' needs KC_SPI_DIGIT_SMS_SENDER_HTTP_URL");
        }
        sender = new HttpSmsSender(url.trim(), scope.apply("http-token"), JsonPoster.http());
    }

    @Override
    public String getId() {
        return SmsSenderSelection.HTTP;
    }
}
