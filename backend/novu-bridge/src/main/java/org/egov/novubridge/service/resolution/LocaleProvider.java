package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

import java.util.Map;

/** SPI: which language each person wants to be written to in. Called once per tenant per event. */
public interface LocaleProvider {

    /**
     * @return user uuid to preferred locale; never null. Empty is the normal answer. An
     *         unreachable source returns empty rather than throwing: a preference outage must only
     *         stop a message being translated, never stop it being sent.
     */
    Map<String, String> preferredLocales(String tenantId, RequestInfo requestInfo);
}
