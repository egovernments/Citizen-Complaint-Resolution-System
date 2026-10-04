package org.egov.pgr.onboarding;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class OnboardingPrincipal {
    private String issuer;
    private String subject;
    private String email;
    private String name;
    private boolean emailVerified;

    public OnboardingPrincipal(String issuer, String subject, String email, String name) {
        this(issuer, subject, email, name, false);
    }
}
