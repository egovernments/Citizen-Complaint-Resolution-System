package org.egov.identity.keycloak.sms;

import java.util.function.Function;
import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;

public class LogSmsSenderFactory implements DigitSmsSenderFactory {

    private static final Logger LOG = Logger.getLogger(LogSmsSenderFactory.class);
    private boolean includeText;

    @Override
    public DigitSmsSender create(KeycloakSession session) {
        return new LogSmsSender(includeText);
    }

    @Override
    public void init(Config.Scope config) {
        Function<String, String> scope = SmsSenderSelection.keycloakScope();
        includeText = SmsSenderSelection.allowDev(scope);
        String warning = SmsSenderSelection.logModeWarning(scope);
        if (warning != null) {
            LOG.warn("**************************************************************");
            LOG.warn(warning);
            LOG.warn("**************************************************************");
        }
    }

    @Override
    public String getId() {
        return SmsSenderSelection.LOG;
    }
}
