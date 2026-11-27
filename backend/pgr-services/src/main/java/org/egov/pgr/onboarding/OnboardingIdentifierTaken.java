package org.egov.pgr.onboarding;

import org.egov.tracer.model.CustomException;

/**
 * ONBOARDING_IDENTIFIER_TAKEN, carrying which identifier is taken. The API answers with that type as
 * {@code identifierType} beside the code (OnboardingApiController), so the configurator can put the
 * refusal under the field it belongs to without reading the message (#2775).
 */
public class OnboardingIdentifierTaken extends CustomException {

    private static final long serialVersionUID = 1L;

    private final String identifierType;

    /** {@code how} finishes "&lt;TYPE&gt; is already …": "in use" for a check, "reserved" for a reservation. */
    public OnboardingIdentifierTaken(String identifierType, String how) {
        super("ONBOARDING_IDENTIFIER_TAKEN", identifierType + " is already " + how);
        this.identifierType = identifierType;
    }

    public String getIdentifierType() {
        return identifierType;
    }
}
