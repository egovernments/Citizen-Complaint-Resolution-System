package org.egov.novubridge.service.delivery;

/**
 * A transport the bridge can hand a rendered message to. Implementations own every
 * vendor-specific detail (recipient formatting, template envelopes, integration selection);
 * the pipeline only asks {@link #supports} and calls {@link #send}.
 *
 * <p>Contract: {@link #send} returns a {@link DeliveryResult} for every transport outcome it can
 * observe. It may throw a {@code CustomException} for an infrastructure failure it cannot
 * express as a result; the pipeline persists that as {@code FAILED/<code>} and re-throws so the
 * consumer DLQs the event.
 */
public interface DeliveryProvider {

    /** Stable id recorded alongside results (e.g. {@code novu}, {@code smscountry}). */
    String id();

    /** Whether this provider can carry the given channel (SMS | WHATSAPP | EMAIL). */
    boolean supports(String channel);

    DeliveryResult send(Dispatch dispatch);
}
