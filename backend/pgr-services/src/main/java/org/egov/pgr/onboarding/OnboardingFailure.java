package org.egov.pgr.onboarding;

import java.util.List;

public class OnboardingFailure extends RuntimeException {
    private final String code;
    private final boolean retryable;
    /** The remote HTTP status when a call was answered with an error, else null. */
    private final Integer httpStatus;
    /** Every error code the remote answered with; {@link #getCode()} is the first. */
    private final List<String> codes;
    public OnboardingFailure(String code, boolean retryable) {
        this(code, retryable, null);
    }
    public OnboardingFailure(String code, boolean retryable, Integer httpStatus) {
        this(code, retryable, httpStatus, List.of());
    }
    public OnboardingFailure(String code, boolean retryable, Integer httpStatus, List<String> codes) {
        super(code);
        this.code = code;
        this.retryable = retryable;
        this.httpStatus = httpStatus;
        this.codes = codes.isEmpty() ? List.of(code) : List.copyOf(codes);
    }
    public String getCode() { return code; }
    public List<String> getCodes() { return codes; }
    public boolean isRetryable() { return retryable; }
    public Integer getHttpStatus() { return httpStatus; }
}
