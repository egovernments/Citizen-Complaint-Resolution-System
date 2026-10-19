package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

import java.util.List;

/** SPI: localization code to message. The producer picks the codes; the box looks them up. */
public interface LocalizationProvider {

    /**
     * @param modules searched IN ORDER; the first with a message wins
     * @return null when no module has the code, and on an outage too: the caller then falls back
     *         to the producer's raw literal, never to a blank
     */
    String message(String tenantId, String locale, List<String> modules, String code, RequestInfo requestInfo);
}
