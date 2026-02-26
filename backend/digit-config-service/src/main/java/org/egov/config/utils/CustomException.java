package org.egov.config.utils;

import lombok.Getter;

import java.util.Collections;
import java.util.Map;

@Getter
public class CustomException extends RuntimeException {

    private final String code;
    private final Map<String, String> errors;

    public CustomException(String code, String message) {
        super(message);
        this.code = code;
        this.errors = Collections.singletonMap(code, message);
    }

    public CustomException(Map<String, String> errors) {
        super(errors.toString());
        this.code = "VALIDATION_ERROR";
        this.errors = errors;
    }
}
