package org.egov.novubridge.service.account;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A refusal or failure of the tenant-account and send APIs with its own HTTP status and a stable
 * {@code NB_*} code, rendered in the {@code Errors:[{code,message}]} shape the rest of the bridge
 * uses. Messages never carry a credential, an API key or a message body.
 */
public class AccountException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public AccountException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public AccountException(HttpStatus status, String code, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public ResponseEntity<Map<String, Object>> toResponse() {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", getMessage());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("Errors", List.of(error));
        return new ResponseEntity<>(out, status);
    }
}
