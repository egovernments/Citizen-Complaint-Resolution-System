package org.egov.userpreference.config;

import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.utils.ErrorCodes;
import org.egov.userpreference.utils.ResponseUtil;
import org.egov.userpreference.web.model.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Renders every failure as the DIGIT error envelope the Go handler produced:
 * a capital-{@code Errors} list, and a {@code responseInfo} block whenever the
 * failing request got far enough to have one parsed.
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(CustomException.class)
    public ResponseEntity<ErrorResponse> handleCustomException(CustomException ex) {
        if (ex.getHttpStatus().is5xxServerError()) {
            log.error("Request failed: {}", ex.getMessage());
        }
        return new ResponseEntity<>(ErrorResponse.builder()
                .responseInfo(ex.getRequestInfo() == null
                        ? null
                        : ResponseUtil.createResponseInfo(ex.getRequestInfo(), false))
                .errors(ex.getErrors())
                .build(), ex.getHttpStatus());
    }

    /**
     * A body that is missing, truncated or not JSON at all. The Go service
     * reported this from the binding step before any {@code RequestInfo}
     * existed, so no {@code responseInfo} is echoed.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.debug("Rejecting an unreadable request body", ex);
        return new ResponseEntity<>(ErrorResponse.builder()
                .errors(List.of(CustomException.error(ErrorCodes.INVALID_JSON,
                        "Invalid JSON format: " + ex.getMostSpecificCause().getMessage())))
                .build(), HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(MethodArgumentNotValidException ex) {
        List<ErrorResponse.Error> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(fieldError -> CustomException.error(ErrorCodes.INVALID_FIELD,
                        fieldError.getField() + ": " + fieldError.getDefaultMessage()))
                .collect(Collectors.toList());

        return new ResponseEntity<>(ErrorResponse.builder()
                .errors(errors)
                .build(), HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(Exception ex) {
        // Spring raises its routing and content-negotiation failures — unknown
        // path, wrong method, unsupported content type — as exceptions that
        // already carry the right status. Those must keep it: catching them
        // here as a blanket 500 would turn a 404 for a mistyped URL into an
        // alarming server error. Only genuinely unexpected failures fall
        // through to 500, which is the one case the Go handler covered.
        if (ex instanceof org.springframework.web.ErrorResponse errorResponse) {
            HttpStatus status = HttpStatus.valueOf(errorResponse.getStatusCode().value());
            log.debug("Request could not be routed: {}", ex.getMessage());
            return new ResponseEntity<>(ErrorResponse.builder()
                    .errors(List.of(CustomException.error(status.name(), ex.getMessage())))
                    .build(), status);
        }

        log.error("Unexpected error", ex);
        return new ResponseEntity<>(ErrorResponse.builder()
                .errors(List.of(CustomException.error(ErrorCodes.INTERNAL_ERROR,
                        "An unexpected error occurred")))
                .build(), HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
