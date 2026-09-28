package org.egov.identity.keycloak.sms;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;

public class LogSmsSenderFactory implements DigitSmsSenderFactory {

    private boolean includeText;

    @Override
    public DigitSmsSender create(KeycloakSession session) {
        return new LogSmsSender(includeText);
    }

    @Override
    public void init(Config.Scope config) {
        includeText = SmsSenderSelection.allowDev(SmsSenderSelection.keycloakScope());
    }

    @Override
    public String getId() {
        return SmsSenderSelection.LOG;
    }
}
