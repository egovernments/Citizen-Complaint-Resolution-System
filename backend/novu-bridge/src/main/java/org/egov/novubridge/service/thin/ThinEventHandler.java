package org.egov.novubridge.service.thin;

import org.egov.novubridge.web.models.ThinEvent;

/**
 * Everything a validated thin event becomes. The only implementation is
 * {@code NotificationResolver}; there is deliberately no fallback, so a missing bean fails startup.
 *
 * <p>Contract: write a ledger row for every terminal outcome. A configuration answer (no routing,
 * no recipients, no template, over the cap) is a SKIPPED row and must not throw: replaying it
 * would give the same answer. A genuine failure must throw, so the consumer DLQs the event.
 */
public interface ThinEventHandler {

    void handle(ThinEvent event);
}
