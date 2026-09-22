package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

/**
 * SPI: a uuid to a contactable person. Called only for an actor that carries a userId and no
 * contact fields, so contacts for account holders never travel on the broker.
 */
public interface UserHydrator {

    /**
     * @return the person, or null when the directory has no such user (recorded as
     *         NB_CONTACT_MISSING)
     * @throws RuntimeException when the directory cannot be reached; an outage must not be
     *         recorded as a missing contact, which is never retried
     */
    Recipient hydrate(String userId, String type, String tenantId, RequestInfo requestInfo);
}
