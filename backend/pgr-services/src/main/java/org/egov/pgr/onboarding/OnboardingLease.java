package org.egov.pgr.onboarding;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.UUID;

@Getter
@AllArgsConstructor
public class OnboardingLease {
    private final OnboardingOperation operation;
    private final UUID leaseToken;
    private final long leaseExpiresAt;
}
