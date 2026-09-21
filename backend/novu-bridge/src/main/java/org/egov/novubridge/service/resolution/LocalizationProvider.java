package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;

import java.util.List;

/**
 * <b>SPI 3 of 4.</b> Localization code to message.
 *
 * <p>This is the split that makes the thin event work at all. The producer keeps deciding
 * <i>which</i> codes apply — the {@code COMPLAINT_HIERARCHY.<code>} then
 * {@code pgr.complaint.category.<code>} ladder is PGR knowledge nobody else can reconstruct — and
 * the box does the lookup, because the producer builds placeholders once per event while the box
 * renders once per locale.
 */
public interface LocalizationProvider {

    /**
     * The message for one code.
     *
     * @param modules the localization modules to search, IN ORDER; the first with a message wins
     * @return {@code null} when no module has a message for the code, so the caller can try the
     *         next code in the ladder and, failing that, leave the token unsubstituted. Null is
     *         the answer, not an error — an outage returns null too, and the documented result is
     *         the raw value, never a blank.
     */
    String message(String tenantId, String locale, List<String> modules, String code, RequestInfo requestInfo);
}
