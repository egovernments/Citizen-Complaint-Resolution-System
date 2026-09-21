package org.egov.novubridge.service.thin;

import org.egov.novubridge.web.models.ThinEvent;

/**
 * <b>THE SEAM.</b> Everything a thin event becomes, behind one method.
 *
 * <p>The implementation this build runs is
 * {@code org.egov.novubridge.service.resolution.NotificationResolver}: route on
 * {@code eventName}, expand audiences into recipients, read each recipient's locale, render and
 * localize the template once per locale, gate the contact, mint a v1 {@code NotificationEvent}
 * per recipient x channel and hand each to {@code DispatchPipelineService}. It is registered as
 * an ordinary bean, and everything upstream of here — the consumer, the validator, the allowlist,
 * the pipeline — is written against this one method and knows nothing else about it.
 *
 * <p>There is NO fallback implementation, deliberately. A build that shipped a handler which
 * quietly recorded "cannot resolve" would be a build in which a missing bean looked like a
 * working deployment; if the resolution stage is ever absent, Spring must fail to start and say
 * so, which is what a required constructor argument already guarantees.
 *
 * <p><b>The contract an implementation must keep:</b>
 * <ol>
 *   <li>It receives an event that {@link ThinEventValidator} has already accepted: {@code kind},
 *       {@code eventId}, {@code eventType}, {@code module}, {@code eventName} and
 *       {@code tenantId} are present and the {@code eventType} is on the deployment allowlist.
 *       Nothing else is guaranteed — there may be no actors, no data, no seed.</li>
 *   <li><b>It writes its own ledger rows.</b> Every terminal outcome it reaches is a row, without
 *       exception: the messages it dispatched (through {@code DispatchPipelineService}, which
 *       writes them), and the decisions it took before there was a channel (through
 *       {@code DispatchLogRows.channelLess}, which it writes itself). The caller writes nothing
 *       on the strength of the returned value. A decision that produces no row is a silent drop,
 *       which is the failure this whole design exists to end.</li>
 *   <li><b>A configuration decision is not an exception.</b> No routing, no recipients, no
 *       template, an unknown audience scheme, a fan-out over the cap: those are answers. Write
 *       the row, return a result naming the code, do not throw. Throwing would DLQ a message
 *       nobody can fix by replaying it.</li>
 *   <li><b>A genuine failure IS an exception.</b> A {@code CustomException} carrying an
 *       {@code NB_*} code, or anything else, propagates to the consumer, which logs it and DLQs
 *       the event with its code — the same treatment the pre-rendered path gives a transport
 *       failure. An uncatalogued event name belongs here, not above: it is a producer fault the
 *       operator must see and the payload must survive.</li>
 *   <li>It returns non-null. An implementation with nothing to say returns
 *       {@code ThinEventResult.builder().build()}.</li>
 * </ol>
 *
 * <p>There is deliberately no default method and no partial implementation here. An interface
 * that half-works is how a seam becomes a silent no-op.
 */
public interface ThinEventHandler {

    /**
     * Resolve and dispatch one validated thin event, writing a ledger row for every terminal
     * outcome reached.
     *
     * @param event a thin event {@link ThinEventValidator} has accepted; never null
     * @return what became of it; never null
     * @throws org.egov.tracer.model.CustomException for a genuine failure the operator must see
     *         and the DLQ must keep — never for a configuration decision
     */
    ThinEventResult handle(ThinEvent event);
}
