package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

import java.util.Map;

/**
 * <b>SPI 2 of 4.</b> Which language each person wants to be written to in.
 *
 * <p>One call per tenant per fan-out, not one per recipient: the DIGIT implementation reads the
 * whole tenant's preferences once and caches them, because a forty-person role pool would
 * otherwise be forty lookups for a value most people have never set.
 */
public interface LocaleProvider {

    /**
     * User uuid to preferred language for one tenant.
     *
     * @return never null. An <b>empty map is the normal answer</b> for a tenant where nobody has
     *         set a preference, and means "everyone gets the deployment default". A provider that
     *         cannot reach its source returns empty rather than throwing: a preference service
     *         being down must not stop a notification, it must only stop it being translated.
     */
    Map<String, String> preferredLocales(String tenantId, RequestInfo requestInfo);
}
