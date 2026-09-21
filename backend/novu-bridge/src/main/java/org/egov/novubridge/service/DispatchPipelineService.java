package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProvider;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.DeliveryResult;
import org.egov.novubridge.service.delivery.Dispatch;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.*;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.*;

/**
 * Pass-through delivery + tracking pipeline. Module-neutral: nothing below knows what a
 * complaint is.
 *
 * <p>The PRODUCER pre-renders ONE event per (recipient x channel): it has already resolved the
 * recipient, picked + filled + localized the template, and put the final text in
 * {@code renderedBody}. This pipeline does NO resolution. It validates the envelope, applies
 * the delivery gates in a fixed order, hands a {@link Dispatch} to the {@link DeliveryProvider}
 * the registry selects, and records exactly one {@code nb_dispatch_log} row for EVERY terminal
 * outcome — including envelope rejections, which used to go to the DLQ without a trace.
 *
 * <p>Vendor specifics (Novu workflow ids, Twilio WhatsApp envelopes, SMSCountry form posts)
 * live behind the provider seam; nothing here names a transport.
 */
@Service
@Slf4j
public class DispatchPipelineService {

    private static final Set<String> KNOWN_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final DeliveryProviderRegistry providers;
    private final ChannelPolicyClient channelPolicy;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;
    private final ProviderAvailability providerAvailability;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   DeliveryProviderRegistry providers,
                                   ChannelPolicyClient channelPolicy,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config,
                                   ProviderAvailability providerAvailability) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.providers = providers;
        this.channelPolicy = channelPolicy;
        this.dispatchLogRepository = dispatchLogRepository;
        this.config = config;
        this.providerAvailability = providerAvailability;
    }

    public DispatchResult process(NotificationEvent event, boolean send, RequestInfo requestInfo) {
        return process(event, send, requestInfo, null);
    }

    /**
     * The same pipeline, told which inbound kind produced this envelope.
     *
     * <p>The three-argument method above is the pre-rendered path and is unchanged in every
     * observable way: it passes {@code null}, which the repository writes as {@code PRERENDERED},
     * exactly as it did when no such column existed. The resolution stage passes
     * {@code RESOLVED}, so every row it causes says on its face which half of the box produced
     * it — which is how "is this deployment on the thin path" is answered per message, in
     * production, by looking at one column, rather than by reading a config that may have been
     * dropped from an overlay.
     *
     * @param sourcePath {@link DispatchLogEntry#SOURCE_PATH_RESOLVED}, or null for pre-rendered
     */
    public DispatchResult process(NotificationEvent event, boolean send, RequestInfo requestInfo,
                                  String sourcePath) {
        log.info("Processing {} envelope: eventId={}, eventName={}, tenant={}, channel={}, send={}",
                sourcePath == null ? "pre-rendered" : "resolved",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getChannel(), send);

        // Envelope rejections are persisted BEFORE they are thrown: the consumer still DLQs
        // the event, but the operator can now see the rejection in the dispatch log.
        try {
            envelopeValidator.validate(event);
        } catch (CustomException ce) {
            persistRejected(event, null, ce.getCode(), ce.getMessage(), sourcePath);
            throw ce;
        }

        DerivedContext context = deriveContext(event);
        context.setSourcePath(sourcePath);
        String subscriberId = event.getSubscriberId();   // validator guarantees it
        context.setSubscriberId(subscriberId);

        // subscriberId is masked too: when the recipient has no UUID it falls back
        // to `tenantId:mobile`, so it can embed a raw phone number.
        log.info("Derived context: eventId={}, channel={}, subscriberId={}, recipientPhone={}, email={}, locale={}",
                event.getEventId(), context.getChannel(), PiiMask.mask(subscriberId),
                PiiMask.mask(context.getRecipientMobile()), PiiMask.mask(context.getEmail()), context.getLocale());

        // Optional channel-preference gate (the producer owns locale; preferences only gate delivery).
        String recipientUuid = context.getRecipientUserId();
        boolean preferenceAllowed = preferenceServiceClient.isChannelAllowed(
                event.getTenantId(), recipientUuid, context.getRecipientMobile(), context.getChannel());
        if (!preferenceAllowed) {
            persist(event, context, "SKIPPED", "NB_PREFERENCE_DENIED",
                    context.getChannel() + " preference denied", null, 1);
            return DispatchResult.builder()
                    .valid(true)
                    .preferenceAllowed(false)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Preference denied"))
                    .build();
        }

        if (!send) {
            persist(event, context, "RECEIVED", null, null, null, 1);
            return DispatchResult.builder()
                    .valid(true)
                    .preferenceAllowed(true)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Validation only mode"))
                    .build();
        }

        String channel = context.getChannel();
        // Gate 1: unknown/null channel — never guess, never fall back to SMS.
        if (!isKnownChannel(channel)) {
            persist(event, context, "SKIPPED", "NB_UNSUPPORTED_CHANNEL",
                    "Unknown channel: " + channel, null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Unsupported channel " + channel + " skipped"))
                    .build();
        }
        // Gate 2: channel not enabled for THIS tenant (MDMS NotificationChannel row, else the
        // env fallback) — e.g. WHATSAPP pre-onboarding.
        if (!channelPolicy.isEnabled(event.getTenantId(), channel)) {
            persist(event, context, "SKIPPED", "NB_NO_PROVIDER",
                    "Channel " + channel + " is not enabled for tenant " + event.getTenantId(), null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Channel " + channel + " has no enabled provider; skipped"))
                    .build();
        }

        Contact contact = buildContact(event, context);

        // Contact gate (bridge-side defense): an EMAIL event needs an email; SMS/WHATSAPP
        // need a phone. The bridge consumes shared topics and must defend independently of any
        // producer's emission-side filter — a phone-only recipient on an EMAIL row would
        // otherwise trigger the email workflow and phantom-SENT with no address.
        boolean hasRequiredContact = "EMAIL".equalsIgnoreCase(channel)
                ? StringUtils.hasText(contact.getEmail())
                : StringUtils.hasText(contact.getPhone());
        if (!hasRequiredContact) {
            persist(event, context, "SKIPPED", "NB_CONTACT_MISSING",
                    "Recipient has no " + ("EMAIL".equalsIgnoreCase(channel) ? "email" : "phone")
                    + " for channel " + channel, null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Missing contact for channel " + channel))
                    .build();
        }

        // WhatsApp template gate: a business-initiated WhatsApp message MUST reference an approved
        // provider template. A producer emits WHATSAPP events with a null templateId when it found
        // no approved provider template (in PGR: no matching NotificationProviderTemplate row) —
        // persist an auditable SKIP here rather than fall through to a free-form send, which the
        // provider rejects. Bridge-side defense: hold regardless of the producer.
        if ("WHATSAPP".equalsIgnoreCase(channel) && !StringUtils.hasText(event.getTemplateId())) {
            persist(event, context, "SKIPPED", "NB_TEMPLATE_NOT_APPROVED",
                    "No approved provider template for this WhatsApp event; free-form WhatsApp is "
                    + "rejected. Map an approved template in NotificationProviderTemplate.", null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("WhatsApp event has no approved provider template; skipped"))
                    .build();
        }

        // The provider the tenant picked for this channel, if any. Its catalog type comes from
        // the identifier itself (ProviderCatalog mints them with a type prefix), so knowing
        // that an Ozeki integration needs its own request body costs no extra Novu call.
        String integrationIdentifier = channelPolicy.provider(event.getTenantId(), channel);

        // Gate 3: the chosen provider must actually be usable. Novu ACCEPTS a trigger naming a
        // deleted, disabled or wrong-channel integration and only fails the step internally, so
        // without this the row would read SENT for a message that never left. Blank provider =
        // nothing to check and the pre-catalog path is untouched; a Novu that cannot be asked
        // fails OPEN (see ProviderAvailability) — the gate never becomes an outage of its own.
        ProviderAvailability.Result availability =
                providerAvailability.check(integrationIdentifier, channel);
        if (!availability.usable()) {
            persist(event, context, "SKIPPED", "NB_PROVIDER_UNAVAILABLE", availability.getMessage(), null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList(availability.getMessage()))
                    .build();
        }

        Dispatch dispatch = Dispatch.builder()
                .tenantId(event.getTenantId())
                .channel(channel.toUpperCase(Locale.ROOT))
                .subscriberId(subscriberId)
                .contact(contact)
                .body(context.getRenderedBody())
                .subject(context.getRenderedSubject())
                .transactionId(context.getTransactionId())
                .data(event.getData())
                .templateId(event.getTemplateId())
                .contentVariables(event.getContentVariables())
                .integrationIdentifier(integrationIdentifier)
                .providerType(ProviderCatalog.typeFromIdentifier(integrationIdentifier))
                .build();
        DeliveryProvider provider = providers.select(event.getTenantId(), channel);

        DeliveryResult result;
        try {
            result = provider.send(dispatch);
        } catch (CustomException ce) {
            persist(event, context, "FAILED", ce.getCode(), ce.getMessage(), null, 1);
            throw ce;   // consumer logs + DLQs as before
        } catch (Exception e) {
            persist(event, context, "FAILED", "NB_DELIVERY_ERROR", e.getMessage(), null, 1);
            throw e;
        }

        if (!result.isAccepted()) {
            persist(event, context, "FAILED", result.getProviderCode(), result.getProviderMessage(),
                    result.getRawResponse(), 1, result.getProviderRef());
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false).novuStatusCode(result.getStatusCode())
                    .novuResponse(result.getRawResponse())
                    .diagnostics(Collections.singletonList(provider.id() + " rejected: " + result.getProviderCode()))
                    .build();
        }

        log.info("Dispatch accepted: eventId={}, channel={}, provider={}, statusCode={}, ref={}, txn={}",
                event.getEventId(), channel, provider.id(), result.getStatusCode(), result.getProviderRef(),
                PiiMask.mask(context.getTransactionId()));

        persist(event, context, "SENT", null, null, result.getRawResponse(), 1, result.getProviderRef());
        return DispatchResult.builder()
                .valid(true)
                .preferenceAllowed(true)
                .derivedContext(context)
                .novuTriggered(true)
                .novuStatusCode(result.getStatusCode())
                .novuResponse(result.getRawResponse())
                .diagnostics(Collections.singletonList("Dispatch accepted by " + provider.id()))
                .build();
    }

    private boolean isKnownChannel(String channel) {
        return channel != null && KNOWN_CHANNELS.contains(channel.toUpperCase());
    }

    private Contact buildContact(NotificationEvent event, DerivedContext context) {
        Contact contact = event.getContact();
        if (contact != null) {
            return contact;
        }
        // Fallback: a dry-run request without a contact block.
        return Contact.builder()
                .userId(context.getRecipientUserId())
                .type(context.getAudience())
                .name(context.getName())
                .phone(context.getRecipientMobile())
                .email(context.getEmail())
                .locale(context.getLocale())
                .build();
    }

    private DerivedContext deriveContext(NotificationEvent event) {
        Contact c = event.getContact();
        return DerivedContext.builder()
                .channel(event.getChannel())
                .audience(c != null ? c.getType() : null)
                .locale(c != null && StringUtils.hasText(c.getLocale()) ? c.getLocale() : config.getDefaultLocale())
                .recipientMobile(c != null ? c.getPhone() : null)
                .recipientUserId(c != null ? c.getUserId() : null)
                .email(c != null ? c.getEmail() : null)
                .name(c != null ? c.getName() : null)
                .subscriberId(event.getSubscriberId())
                .renderedBody(event.getRenderedBody())
                .renderedSubject(event.getSubject())
                .transactionId(StringUtils.hasText(event.getTransactionId())
                        ? event.getTransactionId()
                        : event.getEventId() + ":" + event.getChannel())
                .build();
    }

    private void persist(NotificationEvent event, DerivedContext context,
                         String status, String errorCode, String errorMessage,
                         Map<String, Object> providerResponse, Integer attemptCount) {
        persist(event, context, status, errorCode, errorMessage, providerResponse, attemptCount, null);
    }

    private void persist(NotificationEvent event, DerivedContext context,
                         String status, String errorCode, String errorMessage,
                         Map<String, Object> providerResponse, Integer attemptCount, String providerRef) {
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .providerRef(providerRef)
                .isTest(false)
                .eventId(event.getEventId())
                .transactionId(context.getTransactionId())
                .referenceNumber(resolveReferenceNumber(event))
                .module(event.getModule())
                .eventName(event.getEventName())
                .tenantId(event.getTenantId())
                .channel(context.getChannel())
                .recipientValue(StringUtils.hasText(context.getSubscriberId())
                        ? context.getSubscriberId() : context.getRecipientUserId())
                .templateKey(resolveTemplateKey(event, context))
                .status(status)
                .attemptCount(attemptCount)
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .providerResponse(providerResponse)
                .sourcePath(context.getSourcePath())
                .createdTime(System.currentTimeMillis())
                .lastModifiedTime(System.currentTimeMillis())
                .build());
    }

    /**
     * A {@code REJECTED} row for an event that failed envelope validation or carried no
     * recipient. Every NOT NULL column gets an honest fallback so a malformed event can still
     * be written down; nothing is invented beyond the literal {@code unknown} markers.
     */
    private void persistRejected(NotificationEvent event, DerivedContext context,
                                 String errorCode, String errorMessage, String sourcePath) {
        String channel = firstNonBlank(context != null ? context.getChannel() : null, event.getChannel(), "UNKNOWN");
        String eventId = firstNonBlank(event.getEventId(), "unknown");
        Contact c = event.getContact();
        String recipient = firstNonBlank(event.getSubscriberId(),
                context != null ? context.getSubscriberId() : null,
                c != null ? c.getUserId() : null, c != null ? c.getPhone() : null, "unknown");
        String transactionId = firstNonBlank(context != null ? context.getTransactionId() : null,
                event.getTransactionId(), eventId + ":" + channel);
        long now = System.currentTimeMillis();
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(eventId)
                .transactionId(transactionId)
                .referenceNumber(resolveReferenceNumber(event))
                .module(firstNonBlank(event.getModule(), "unknown"))
                .eventName(firstNonBlank(event.getEventName(), "unknown"))
                .tenantId(firstNonBlank(event.getTenantId(), "unknown"))
                .channel(channel)
                .recipientValue(recipient)
                .templateKey(event.getTemplateKey())
                .status("REJECTED")
                .attemptCount(1)
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .sourcePath(sourcePath)
                .createdTime(now)
                .lastModifiedTime(now)
                .build());
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) return v;
        }
        return null;
    }

    /**
     * The ledger's {@code reference_number}: the producing module's own handle for whatever this
     * message is about, so an operator can find every notification for one case on the Logs
     * screen. Module-neutral, in this order:
     *
     * <ol>
     *   <li>{@code entityId} — the envelope's own reference field. BOTH shipped producers always
     *       set it (PGR the serviceRequestId, {@code CoreSmsTranslator} the generated id), so
     *       for them this method returns exactly what the previous {@code event.getEntityId()}
     *       returned and existing rows are byte-for-byte unchanged.</li>
     *   <li>{@code data.referenceNumber} — the neutral escape hatch for a producer that carries
     *       its reference in the data block rather than as an entity.</li>
     *   <li>{@code data.complaintNo} — PGR's legacy key, kept as a fallback so an older or
     *       partial complaint event (entityId omitted) still lands under its complaint number
     *       instead of nothing.</li>
     *   <li>{@code eventId} — last resort. Never null, so a row is always addressable; nothing
     *       is invented, the event id is a real handle the producer holds.</li>
     * </ol>
     */
    private static String resolveReferenceNumber(NotificationEvent event) {
        Map<String, Object> data = event.getData();
        return firstNonBlank(event.getEntityId(),
                text(data, "referenceNumber"),
                text(data, "complaintNo"),
                event.getEventId());
    }

    private static String text(Map<String, Object> data, String key) {
        Object value = data == null ? null : data.get(key);
        return value == null ? null : value.toString();
    }

    /**
     * Best-available template identity for the dispatch-log row: the explicit wire value
     * ({@code templateKey} — whatever template identity the producer rendered with; PGR sends
     * the MDMS NotificationTemplate uid) when the producer sends it; otherwise reconstructed
     * from segments the event already carries verbatim — audience (contact.type),
     * action/toState (data block), channel and locale. Events without an action/toState
     * (e.g. OTP, and any producer that does not use that vocabulary) fall back to the
     * eventName, which every envelope is required to carry.
     */
    private String resolveTemplateKey(NotificationEvent event, DerivedContext context) {
        if (StringUtils.hasText(event.getTemplateKey())) {
            return event.getTemplateKey();
        }
        Map<String, Object> data = event.getData();
        Object action = data != null ? data.get("action") : null;
        Object toState = data != null ? data.get("toState") : null;
        if (action != null && toState != null
                && StringUtils.hasText(context.getAudience()) && StringUtils.hasText(context.getChannel())) {
            String key = context.getAudience() + "." + action + "." + toState + "." + context.getChannel();
            return StringUtils.hasText(context.getLocale()) ? key + "." + context.getLocale() : key;
        }
        return event.getEventName();
    }
}
