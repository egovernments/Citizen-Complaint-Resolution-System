package org.egov.config.utils;

import org.egov.config.web.model.RequestInfo;
import org.egov.config.web.model.ResponseInfo;

public class ResponseUtil {

    private ResponseUtil() {
    }

    public static ResponseInfo createResponseInfo(RequestInfo requestInfo, boolean success) {
        return ResponseInfo.builder()
                .apiId(requestInfo != null ? requestInfo.getApiId() : null)
                .ver(requestInfo != null ? requestInfo.getVer() : null)
                .ts(System.currentTimeMillis())
                .msgId(requestInfo != null ? requestInfo.getMsgId() : null)
                .resMsgId(requestInfo != null ? requestInfo.getMsgId() : null)
                .status(success ? "successful" : "failed")
                .build();
    }
}
