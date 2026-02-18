package org.egov.config.utils;

import org.egov.config.web.model.*;

import java.util.List;

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

    public static ConfigEntryResponse getEntryResponse(RequestInfo requestInfo, ConfigEntry entry) {
        return ConfigEntryResponse.builder()
                .responseInfo(createResponseInfo(requestInfo, true))
                .entry(entry)
                .build();
    }

    public static ConfigEntrySearchResponse getSearchResponse(RequestInfo requestInfo,
                                                               List<ConfigEntry> entries,
                                                               Pagination pagination) {
        return ConfigEntrySearchResponse.builder()
                .responseInfo(createResponseInfo(requestInfo, true))
                .entries(entries)
                .pagination(pagination)
                .build();
    }
}
