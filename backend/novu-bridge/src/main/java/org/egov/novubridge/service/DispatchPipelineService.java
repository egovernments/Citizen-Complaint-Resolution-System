package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.service.delivery.DeliveryProvider;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.DeliveryResult;
import org.egov.novubridge.service.delivery.Dispatch;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.util.Values;
import org.egov.novubridge.web.models.*;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.*;

/**
 * Pass-through delivery pipeline: validate the pre-rendered envelope, apply the gates in a fixed
 * order, hand a {@link Dispatch} to the selected {@link DeliveryProvider}, and record exactly one
 * {@code nb_dispatch_log} row for every terminal outcome (envelope rejections included).
 */
@Service
@Slf4j
public class DispatchPipelineService {

    private static final Set<String> KNOWN_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");
    /** Ledger statuses that mean the message already left; a replay must not send it again. */
    private static final Set<String> ALREADY_SENT = Set.of("SENT", "DELIVERED");

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

    /** @param sourcePath {@link DispatchLogEntry#SOURCE_PATH_RESOLVED}, or null for pre-rendered */
    public DispatchResult process(NotificationEvent event, boolean send, RequestInfo requestInfo,
                                  String sourcePath) {
        log.info("Processing {} envelope: eventId={}, eventName={}, tenant={}, channel={}, send={}",
                sourcePath == null ? "pre-rendered" : "resolved",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getChannel(), send);

        // Rejections are written down BEFORE they are thrown; the consumer still DLQs the event.
        try {
            envelopeValidator.validate(event);
        } catch (CustomException ce) {
            persistRejected(event, ce.getCode(), ce.getMessage(), sourcePath);
            throw ce;
        }

        DerivedContext context = deriveContext(event);
        context.setSourcePath(sourcePath);
        String subscriberId = event.getSubscriberId();
        context.setSubscriberId(subscriberId);
        // subscriberId is masked too: without a UUID it falls back to tenantId:mobile.
        log.info("Derived context: eventId={}, channel={}, subscriberId={}, recipientPhone={}, email={}, locale={}",
                event.getEventId(), context.getChannel(), PiiMask.mask(subscriberId),
                PiiMask.mask(context.getRecipientMobile()), PiiMask.mask(context.getEmail()), context.getLocale());

        // Replay guard (DLQ replay, Kafka redelivery): checked before any gate so a replay can
        // neither re-send nor overwrite the SENT row with a later SKIPPED.
        String priorStatus = dispatchLogRepository.findStatus(
                context.getTransactionId(), context.getChannel(), recipientValue(context));
        if (priorStatus != null && ALREADY_SENT.contains(priorStatus)) {
            log.info("Already {}: eventId={} txn={} channel={}; not sending again", priorStatus,
                    event.getEventId(), PiiMask.mask(context.getTransactionId()), context.getChannel());
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context).novuTriggered(false)
                    .diagnostics(List.of("Already " + priorStatus + " for this transaction; not sent again"))
                    .build();
        }

        if (!CoreSmsTranslator.isConsentExempt(event)
                && !preferenceServiceClient.isChannelAllowed(event.getTenantId(), context.getRecipientUserId(),
                        context.getRecipientMobile(), context.getChannel())) {
            persist(event, context, "SKIPPED", "NB_PREFERENCE_DENIED", context.getChannel() + " preference denied");
            return skipped(context, "Preference denied").preferenceAllowed(false).build();
        }

        if (!send) {
            persist(event, context, "RECEIVED", null, null);
            return skipped(context, "Validation only mode").build();
        }

        String channel = context.getChannel();
        // Never guess a channel, never fall back to SMS.
        if (channel == null || !KNOWN_CHANNELS.contains(channel.toUpperCase())) {
            return skip(event, context, "NB_UNSUPPORTED_CHANNEL", "Unknown channel: " + channel,
                    "Unsupported channel " + channel + " skipped");
        }
        if (!channelPolicy.isEnabled(event.getTenantId(), channel)) {
            return skip(event, context, "NB_NO_PROVIDER",
                    "Channel " + channel + " is not enabled for tenant " + event.getTenantId(),
                    "Channel " + channel + " has no enabled provider; skipped");
        }

        Contact contact = buildContact(event, context);
        // The bridge consumes shared topics, so it defends independently of producer-side filters:
        // an EMAIL row with no address would otherwise phantom-SENT.
        boolean email = "EMAIL".equalsIgnoreCase(channel);
        if (!StringUtils.hasText(email ? contact.getEmail() : contact.getPhone())) {
            return skip(event, context, "NB_CONTACT_MISSING",
                    "Recipient has no " + (email ? "email" : "phone") + " for channel " + channel,
                    "Missing contact for channel " + channel);
        }
        // Business-initiated WhatsApp must use an approved template; the provider rejects free-form.
        if ("WHATSAPP".equalsIgnoreCase(channel) && !StringUtils.hasText(event.getTemplateId())) {
            return skip(event, context, "NB_TEMPLATE_NOT_APPROVED",
                    "No approved provider template for this WhatsApp event; free-form WhatsApp is "
                            + "rejected. Map an approved template in NotificationProviderTemplate.",
                    "WhatsApp event has no approved provider template; skipped");
        }

        String integrationIdentifier = channelPolicy.provider(event.getTenantId(), channel);
        // Novu ACCEPTS a trigger naming a deleted/disabled/wrong-channel integration and fails it
        // internally, so without this check the row would read SENT for a message that never left.
        ProviderAvailability.Result availability = providerAvailability.check(integrationIdentifier, channel);
        if (!availability.usable()) {
            return skip(event, context, "NB_PROVIDER_UNAVAILABLE", availability.message(), availability.message());
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
            persist(event, context, "FAILED", ce.getCode(), ce.getMessage());
            throw ce;
        } catch (Exception e) {
            persist(event, context, "FAILED", "NB_DELIVERY_ERROR", e.getMessage());
            throw e;
        }

        if (!result.isAccepted()) {
            persist(event, context, "FAILED", result.getProviderCode(), result.getProviderMessage(),
                    result.getRawResponse(), result.getProviderRef());
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
        persist(event, context, "SENT", null, null, result.getRawResponse(), result.getProviderRef());
        return DispatchResult.builder()
                .valid(true).preferenceAllowed(true).derivedContext(context)
                .novuTriggered(true)
                .novuStatusCode(result.getStatusCode())
                .novuResponse(result.getRawResponse())
                .diagnostics(Collections.singletonList("Dispatch accepted by " + provider.id()))
                .build();
    }

    /** Persist a SKIPPED row for a gate refusal and build the matching result. */
    private DispatchResult skip(NotificationEvent event, DerivedContext context, String code,
                                String rowMessage, String diagnostic) {
        persist(event, context, "SKIPPED", code, rowMessage);
        return skipped(context, diagnostic).build();
    }

    private static DispatchResult.DispatchResultBuilder skipped(DerivedContext context, String diagnostic) {
        return DispatchResult.builder()
                .valid(true).preferenceAllowed(true).derivedContext(context)
                .novuTriggered(false)
                .diagnostics(Collections.singletonList(diagnostic));
    }

    private Contact buildContact(NotificationEvent event, DerivedContext context) {
        if (event.getContact() != null) {
            return event.getContact();
        }
        // A dry-run request without a contact block.
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

    /** The recipient half of the ledger's unique key (transaction_id, channel, recipient_value). */
    private static String recipientValue(DerivedContext context) {
        return StringUtils.hasText(context.getSubscriberId()) ? context.getSubscriberId() : context.getRecipientUserId();
    }

    private void persist(NotificationEvent event, DerivedContext context,
                         String status, String errorCode, String errorMessage) {
        persist(event, context, status, errorCode, errorMessage, null, null);
    }

    private void persist(NotificationEvent event, DerivedContext context, String status, String errorCode,
                         String errorMessage, Map<String, Object> providerResponse, String providerRef) {
        long now = System.currentTimeMillis();
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
                .recipientValue(recipientValue(context))
                .templateKey(resolveTemplateKey(event, context))
                .status(status)
                .attemptCount(1)
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .providerResponse(providerResponse)
                .sourcePath(context.getSourcePath())
                .createdTime(now)
                .lastModifiedTime(now)
                .build());
    }

    /** A REJECTED row for an envelope that failed validation; only literal {@code unknown} markers are invented. */
    private void persistRejected(NotificationEvent event, String errorCode, String errorMessage, String sourcePath) {
        String channel = Values.firstText(event.getChannel(), "UNKNOWN");
        String eventId = Values.firstText(event.getEventId(), "unknown");
        Contact c = event.getContact();
        String recipient = Values.firstText(event.getSubscriberId(),
                c != null ? c.getUserId() : null, c != null ? c.getPhone() : null, "unknown");
        long now = System.currentTimeMillis();
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(eventId)
                .transactionId(Values.firstText(event.getTransactionId(), eventId + ":" + channel))
                .referenceNumber(resolveReferenceNumber(event))
                .module(Values.firstText(event.getModule(), "unknown"))
                .eventName(Values.firstText(event.getEventName(), "unknown"))
                .tenantId(Values.firstText(event.getTenantId(), "unknown"))
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

    /** The ledger's reference_number: entityId, then data.referenceNumber, data.complaintNo (PGR legacy), eventId. */
    private static String resolveReferenceNumber(NotificationEvent event) {
        Map<String, Object> data = event.getData();
        return Values.firstText(event.getEntityId(),
                data == null ? null : Values.str(data.get("referenceNumber")),
                data == null ? null : Values.str(data.get("complaintNo")),
                event.getEventId());
    }

    /**
     * The producer's templateKey when sent; else reconstructed from audience.action.toState.channel[.locale];
     * else the eventName (OTP and producers without that vocabulary).
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
