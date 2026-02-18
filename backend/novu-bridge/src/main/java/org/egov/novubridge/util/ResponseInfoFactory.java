package org.egov.novubridge.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.response.ResponseInfo;
import org.springframework.stereotype.Component;

@Component
public class ResponseInfoFactory {

    public ResponseInfo createResponseInfoFromRequestInfo(final RequestInfo requestInfo, final Boolean success) {
        final String apiId = requestInfo != null ? requestInfo.getApiId() : null;
        final String ver = requestInfo != null ? requestInfo.getVer() : null;
        final Long ts = System.currentTimeMillis();
        final String msgId = requestInfo != null ? requestInfo.getMsgId() : null;
        final String resMsgId = msgId != null ? msgId : String.valueOf(ts);
        return ResponseInfo.builder().apiId(apiId).ver(ver).ts(ts).resMsgId(resMsgId).status(success ? "successful" : "failed").build();
    }
}
