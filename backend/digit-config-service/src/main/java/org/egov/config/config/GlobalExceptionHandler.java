package org.egov.config.config;

import org.egov.config.utils.CustomException;
import org.egov.config.web.model.ErrorResponse;
import org.egov.config.web.model.ResponseInfo;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(CustomException.class)
    public ResponseEntity<ErrorResponse> handleCustomException(CustomException ex) {
        List<ErrorResponse.Error> errors = ex.getErrors().entrySet().stream()
                .map(e -> ErrorResponse.Error.builder()
                        .code(e.getKey())
                        .message(e.getValue())
                        .build())
                .collect(Collectors.toList());

        ErrorResponse response = ErrorResponse.builder()
                .responseInfo(ResponseInfo.builder()
                        .status("failed")
                        .ts(System.currentTimeMillis())
                        .build())
                .errors(errors)
                .build();

        return new ResponseEntity<>(response, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(MethodArgumentNotValidException ex) {
        List<ErrorResponse.Error> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> ErrorResponse.Error.builder()
                        .code("INVALID_FIELD")
                        .message(fe.getField() + ": " + fe.getDefaultMessage())
                        .build())
                .collect(Collectors.toList());

        ErrorResponse response = ErrorResponse.builder()
                .responseInfo(ResponseInfo.builder()
                        .status("failed")
                        .ts(System.currentTimeMillis())
                        .build())
                .errors(errors)
                .build();

        return new ResponseEntity<>(response, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(Exception ex) {
        ErrorResponse response = ErrorResponse.builder()
                .responseInfo(ResponseInfo.builder()
                        .status("failed")
                        .ts(System.currentTimeMillis())
                        .build())
                .errors(List.of(ErrorResponse.Error.builder()
                        .code("INTERNAL_SERVER_ERROR")
                        .message(ex.getMessage())
                        .build()))
                .build();

        return new ResponseEntity<>(response, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
