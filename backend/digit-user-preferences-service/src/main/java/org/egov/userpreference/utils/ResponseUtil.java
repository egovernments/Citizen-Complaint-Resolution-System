package org.egov.userpreference.utils;

import org.egov.userpreference.web.model.RequestInfo;
import org.egov.userpreference.web.model.ResponseInfo;

public class ResponseUtil {

    private ResponseUtil() {
    }

    /**
     * Echo the request's identifiers back with a fresh timestamp.
     *
     * <p>{@code resMsgId} is deliberately left unset: the Go service's
     * {@code NewResponseInfo} never populated it, so setting it here (as
     * digit-config-service does) would add a key the existing contract does
     * not carry.
     */
    public static ResponseInfo createResponseInfo(RequestInfo requestInfo, boolean success) {
        return ResponseInfo.builder()
                .apiId(requestInfo != null ? requestInfo.getApiId() : null)
                .ver(requestInfo != null ? requestInfo.getVer() : null)
                .ts(System.currentTimeMillis())
                .msgId(requestInfo != null ? requestInfo.getMsgId() : null)
                .status(success ? "successful" : "failed")
                .build();
    }
}
