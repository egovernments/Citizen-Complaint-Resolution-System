package org.egov.pgr.onboarding;

public class OnboardingFailure extends RuntimeException {
    private final String code;
    private final boolean retryable;
    public OnboardingFailure(String code, boolean retryable) {
        super(code);
        this.code = code;
        this.retryable = retryable;
    }
    public String getCode() { return code; }
    public boolean isRetryable() { return retryable; }
}
