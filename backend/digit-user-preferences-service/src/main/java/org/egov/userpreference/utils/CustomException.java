package org.egov.userpreference.utils;

import lombok.Getter;
import org.egov.userpreference.web.model.ErrorResponse;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.http.HttpStatus;

import java.util.List;

/**
 * Carries a DIGIT error list plus the status it should be served with.
 *
 * <p>Unlike digit-config-service's equivalent this holds an ordered
 * {@code List}, not a {@code Map} keyed by error code. The validators can emit
 * the same code twice for one field — an empty {@code preferenceCode} trips
 * both "is required" and "must be between 2 and 128 characters" — and a map
 * would silently swallow one of them.
 *
 * <p>The originating {@link RequestInfo} travels with the exception so the
 * handler can echo a {@code responseInfo} block on the error response, which
 * is what the Go handler did with the request it still had in scope.
 */
@Getter
public class CustomException extends RuntimeException {

    private final List<ErrorResponse.Error> errors;
    private final transient RequestInfo requestInfo;
    private final HttpStatus httpStatus;

    private CustomException(List<ErrorResponse.Error> errors, RequestInfo requestInfo, HttpStatus httpStatus) {
        super(errors.isEmpty() ? httpStatus.getReasonPhrase() : errors.get(0).getMessage());
        this.errors = List.copyOf(errors);
        this.requestInfo = requestInfo;
        this.httpStatus = httpStatus;
    }

    /** A 400 carrying every validation failure found, in the order found. */
    public static CustomException validation(List<ErrorResponse.Error> errors, RequestInfo requestInfo) {
        return new CustomException(errors, requestInfo, HttpStatus.BAD_REQUEST);
    }

    /** A 400 for a single named failure. */
    public static CustomException validation(String code, String message, RequestInfo requestInfo) {
        return validation(List.of(error(code, message)), requestInfo);
    }

    /** A 500 for a failure below the service layer, e.g. an unreachable database. */
    public static CustomException internal(String message, RequestInfo requestInfo) {
        return new CustomException(List.of(error(ErrorCodes.INTERNAL_ERROR, message)), requestInfo,
                HttpStatus.INTERNAL_SERVER_ERROR);
    }

    public static ErrorResponse.Error error(String code, String message) {
        return ErrorResponse.Error.builder().code(code).message(message).build();
    }
}
