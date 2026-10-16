package org.egov.pgr.onboarding;

public class OnboardingFailure extends RuntimeException {
    private final String code;
    private final boolean retryable;
    /** The remote HTTP status when a call was answered with an error, else null. */
    private final Integer httpStatus;
    public OnboardingFailure(String code, boolean retryable) {
        this(code, retryable, null);
    }
    public OnboardingFailure(String code, boolean retryable, Integer httpStatus) {
        super(code);
        this.code = code;
        this.retryable = retryable;
        this.httpStatus = httpStatus;
    }
    public String getCode() { return code; }
    public boolean isRetryable() { return retryable; }
    public Integer getHttpStatus() { return httpStatus; }
}
