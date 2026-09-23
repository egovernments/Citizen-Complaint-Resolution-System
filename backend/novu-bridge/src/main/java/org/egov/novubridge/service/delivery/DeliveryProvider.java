package org.egov.novubridge.service.delivery;

/**
 * A transport the bridge can hand a rendered message to; implementations own every vendor detail.
 * {@link #send} may throw a {@code CustomException} for an infrastructure failure it cannot express
 * as a result: the pipeline persists that as {@code FAILED/<code>} and re-throws so the consumer DLQs.
 */
public interface DeliveryProvider {

    /** Stable id recorded alongside results (e.g. {@code novu}, {@code smscountry}). */
    String id();

    DeliveryResult send(Dispatch dispatch);
}
