package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

/**
 * <b>SPI 4 of 4.</b> A uuid to a contactable person.
 *
 * <p>This is what lets a producer name an actor by uuid alone, which is the single biggest PII
 * reduction in the thin-event design: a role notification to a forty-person pool used to put forty
 * phone numbers on a Kafka topic and now puts none.
 *
 * <p>Hydration happens only when the producer supplied a {@code userId} and <b>no contact fields at
 * all</b>. An actor ref that carries a name, phone or email is used verbatim — that form exists
 * for recipients with no account, and looking one up would either fail or, worse, overwrite the
 * only contact anyone has for them.
 */
public interface UserHydrator {

    /**
     * @return the person, or {@code null} when the directory has no such user or cannot be
     *         reached. Null is not an exception: the caller reports an unreachable recipient as a
     *         ledger row, which is more useful than a DLQ'd event nobody can replay into success.
     */
    Recipient hydrate(String userId, String type, String tenantId, RequestInfo requestInfo);
}
