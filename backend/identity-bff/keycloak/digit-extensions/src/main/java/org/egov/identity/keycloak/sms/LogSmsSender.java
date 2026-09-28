package org.egov.identity.keycloak.sms;

import org.jboss.logging.Logger;

/**
 * Default sender: writes one log line per SMS. The message text (which holds
 * the OTP) is only logged when ALLOW_DEV is true; otherwise the line proves a
 * send happened without making server logs a code oracle.
 */
public final class LogSmsSender implements DigitSmsSender {

    private static final Logger LOG = Logger.getLogger(LogSmsSender.class);
    private final boolean includeText;

    public LogSmsSender(boolean includeText) {
        this.includeText = includeText;
    }

    @Override
    public void send(String e164, String text, SmsContext context) {
        String to = e164.length() > 4 ? "…" + e164.substring(e164.length() - 3) : "…";
        if (includeText) {
            LOG.infof("digit-sms[log] to=%s tenant=%s purpose=%s text=%s", e164, context.tenant(), context.purpose(), text);
        } else {
            LOG.infof("digit-sms[log] to=%s tenant=%s purpose=%s chars=%d (text withheld; set allow-dev to log it)",
                    to, context.tenant(), context.purpose(), text.length());
        }
    }
}
