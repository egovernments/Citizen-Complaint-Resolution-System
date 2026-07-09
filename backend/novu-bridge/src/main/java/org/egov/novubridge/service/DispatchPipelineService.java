package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.*;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.util.*;

/**
 * Pass-through delivery + tracking pipeline.
 *
 * <p>PGR now pre-renders ONE event per (recipient x channel): it has already
 * resolved the recipient, picked + filled + localized the template, and put the
 * final text in {@code renderedBody}. novu-bridge therefore does NOT resolve
 * templates, providers, or localization. It only:
 * <ol>
 *   <li>upserts the Novu subscriber (identify, D6) with the carried profile,</li>
 *   <li>delivers the rendered body via the per-channel Novu workflow for every ENABLED channel
 *       (novu.bridge.channels.enabled); known-but-disabled channels (e.g. WHATSAPP with no
 *       provider) persist an explicit SKIPPED/NB_NO_PROVIDER row, and</li>
 *   <li>records the result in {@code nb_dispatch_log} keyed by transactionId.</li>
 * </ol>
 */
@Service
@Slf4j
public class DispatchPipelineService {

    private static final Set<String> KNOWN_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final NovuClient novuClient;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;
    private final MdmsServiceClient mdmsServiceClient;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   NovuClient novuClient,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config,
                                   MdmsServiceClient mdmsServiceClient) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.novuClient = novuClient;
        this.dispatchLogRepository = dispatchLogRepository;
        this.config = config;
        this.mdmsServiceClient = mdmsServiceClient;
    }

    public DispatchResult process(ComplaintsDomainEvent event, boolean send, RequestInfo requestInfo) {
        log.info("Processing pre-rendered domain event: eventId={}, eventName={}, tenant={}, channel={}, send={}",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getChannel(), send);

        envelopeValidator.validate(event);

        DerivedContext context = deriveContext(event);
        String subscriberId = StringUtils.hasText(event.getSubscriberId())
                ? event.getSubscriberId()
                : context.getSubscriberId();
        if (!StringUtils.hasText(subscriberId)) {
            // Record the terminal status before throwing — every other branch in
            // process() persists, and the class invariant is that every consumed
            // event leaves an explicit status row in nb_dispatch_log.
            persist(event, context, "FAILED", "NB_SUBSCRIBER_ID_MISSING",
                    "subscriberId is required (PGR resolved it; null means a bad event)", null, 1);
            throw new CustomException("NB_SUBSCRIBER_ID_MISSING",
                    "subscriberId is required (PGR resolved it; null means a bad event)");
        }
        context.setSubscriberId(subscriberId);

        // subscriberId is masked too: when the recipient has no UUID it falls back
        // to `tenantId:mobile`, so it can embed a raw phone number.
        log.info("Derived context: eventId={}, channel={}, subscriberId={}, recipientPhone={}, email={}, locale={}",
                event.getEventId(), context.getChannel(), PiiMask.mask(subscriberId),
                PiiMask.mask(context.getRecipientMobile()), PiiMask.mask(context.getEmail()), context.getLocale());

        // Optional channel-preference gate (PGR owns locale; preferences only gate delivery).
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
        // Gate 2: known channel with no enabled provider (e.g. WHATSAPP pre-onboarding).
        if (!config.isChannelEnabled(channel)) {
            persist(event, context, "SKIPPED", "NB_NO_PROVIDER",
                    "No provider enabled for channel " + channel, null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Channel " + channel + " has no enabled provider; skipped"))
                    .build();
        }

        Contact contact = buildContact(event, context);

        // Contact gate (bridge-side defense): an EMAIL event needs an email; SMS/WHATSAPP
        // need a phone. The bridge consumes a shared topic and must defend independently of
        // PGR's emission-side filter — a phone-only recipient on an EMAIL row would otherwise
        // trigger complaints-email and phantom-SENT with no address.
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

        NovuClient.NovuResponse response;
        try {
            response = novuClient.identifyThenTrigger(
                    subscriberId, contact, channel,
                    context.getRenderedBody(), context.getRenderedSubject(),
                    context.getTransactionId(), event.getData());
        } catch (CustomException ce) {
            persist(event, context, "FAILED", ce.getCode(), ce.getMessage(), null, 1);
            throw ce;   // consumer logs + DLQs as before
        } catch (Exception e) {
            persist(event, context, "FAILED", "NB_DELIVERY_ERROR", e.getMessage(), null, 1);
            throw e;
        }

        Integer sc = response != null ? response.getStatusCode() : null;
        boolean delivered = sc != null && sc >= 200 && sc < 300;
        if (!delivered) {
            persist(event, context, "FAILED", "NB_NOVU_TRIGGER_FAILED",
                    "Novu returned status " + sc, response != null ? response.getResponse() : null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false).novuStatusCode(sc)
                    .novuResponse(response != null ? response.getResponse() : null)
                    .diagnostics(Collections.singletonList("Novu trigger failed: status " + sc))
                    .build();
        }

        log.info("Dispatch response: eventId={}, channel={}, statusCode={}, txn={}",
                event.getEventId(), channel, sc, PiiMask.mask(context.getTransactionId()));

        persist(event, context, "SENT", null, null,
                response != null ? response.getResponse() : null, 1);
        return DispatchResult.builder()
                .valid(true)
                .preferenceAllowed(true)
                .derivedContext(context)
                .novuTriggered(true)
                .novuStatusCode(sc)
                .novuResponse(response != null ? response.getResponse() : null)
                .diagnostics(Collections.singletonList("Dispatch successful"))
                .build();
    }

    public NovuClient.NovuResponse testTrigger(String workflowId, String subscriberId, String phone,
                                               Map<String, Object> payload, String transactionId,
                                               String contentSid, Map<String, String> contentVariables,
                                               RequestInfo requestInfo) {
        // Pass-through test path: trigger Novu directly with the supplied payload.
        // contentSid/contentVariables are accepted for backward-compatible request
        // shape but no longer used (PGR owns rendering).
        return novuClient.trigger(
                workflowId,
                subscriberId,
                formatRecipientPhone(phone, null, config.getChannel(), requestInfo),
                null,
                payload,
                transactionId);
    }

    private boolean isKnownChannel(String channel) {
        return channel != null && KNOWN_CHANNELS.contains(channel.toUpperCase());
    }

    private Contact buildContact(ComplaintsDomainEvent event, DerivedContext context) {
        Contact contact = event.getContact();
        if (contact != null) {
            return contact;
        }
        // Fallback: assemble a Contact from the derived context (e.g. legacy
        // stakeholders[] envelope or dry-run requests without a contact block).
        return Contact.builder()
                .userId(context.getRecipientUserId())
                .type(context.getAudience())
                .name(context.getName())
                .phone(context.getRecipientMobile())
                .email(context.getEmail())
                .locale(context.getLocale())
                .build();
    }

    private String formatRecipientPhone(String mobile, String tenantId, String channel, RequestInfo requestInfo) {
        if (!StringUtils.hasText(mobile)) {
            return null;
        }
        boolean isWhatsapp = "whatsapp".equalsIgnoreCase(channel);
        String normalized = mobile.trim();

        // Strip any pre-existing whatsapp: prefix so we control formatting from here.
        if (normalized.startsWith("whatsapp:")) {
            normalized = normalized.substring("whatsapp:".length());
        }

        String e164;
        if (normalized.startsWith("+")) {
            e164 = normalized;
        } else {
            // Fetch default country-code prefix from MDMS
            if (!StringUtils.hasText(tenantId)) {
                throw new CustomException("NB_TENANT_ID_MISSING",
                        "tenantId is required to resolve phone country-code prefix from MDMS");
            }
            MobileValidationConfig validationConfig = mdmsServiceClient.getMobileValidationConfig(tenantId, requestInfo);
            if (!normalized.matches(validationConfig.getMobileNumberRegex())) {
                throw new CustomException("NB_INVALID_MOBILE_NUMBER",
                        "Mobile number does not match the configured pattern for tenantId=" + tenantId);
            }
            e164 = validationConfig.getCountryCode() + normalized;
        }

        // Twilio Programmable WhatsApp requires the "whatsapp:" prefix; SMS takes raw E.164.
        return isWhatsapp ? "whatsapp:" + e164 : e164;
    }

    private DerivedContext deriveContext(ComplaintsDomainEvent event) {
        // Primary path: the pre-rendered per-recipient event carries everything flat.
        if (event.getContact() != null || StringUtils.hasText(event.getRenderedBody())) {
            Contact c = event.getContact();
            return DerivedContext.builder()
                    .channel(StringUtils.hasText(event.getChannel()) ? event.getChannel() : config.getChannel())
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

        // Backward-compat fallback: legacy stakeholders[] envelope.
        Stakeholder stakeholder = null;
        if (!CollectionUtils.isEmpty(event.getStakeholders())) {
            stakeholder = event.getStakeholders().stream()
                    .filter(s -> StringUtils.hasText(s.getMobile()))
                    .findFirst()
                    .orElse(event.getStakeholders().get(0));
        }
        String locale = event.getContext() != null && StringUtils.hasText(event.getContext().getLocale())
                ? event.getContext().getLocale() : config.getDefaultLocale();
        return DerivedContext.builder()
                .channel(StringUtils.hasText(event.getChannel()) ? event.getChannel() : config.getChannel())
                .audience(stakeholder != null ? stakeholder.getType() : null)
                .workflowState(event.getWorkflow() != null ? event.getWorkflow().getToState() : null)
                .locale(stakeholder != null && StringUtils.hasText(stakeholder.getLocale())
                        ? stakeholder.getLocale() : locale)
                .recipientMobile(stakeholder != null ? stakeholder.getMobile() : null)
                .recipientUserId(stakeholder != null ? stakeholder.getUserId() : null)
                .email(stakeholder != null ? stakeholder.getEmail() : null)
                .renderedBody(stakeholder != null ? stakeholder.getRenderedBody() : event.getRenderedBody())
                .renderedSubject(stakeholder != null ? stakeholder.getRenderedSubject() : event.getSubject())
                .subscriberId(event.getSubscriberId())
                .transactionId(StringUtils.hasText(event.getTransactionId())
                        ? event.getTransactionId()
                        : event.getEventId() + ":" + event.getChannel())
                .build();
    }

    private void persist(ComplaintsDomainEvent event, DerivedContext context,
                         String status, String errorCode, String errorMessage,
                         Map<String, Object> providerResponse, Integer attemptCount) {
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(event.getEventId())
                .transactionId(context.getTransactionId())
                .referenceNumber(event.getEntityId())
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
                .createdTime(System.currentTimeMillis())
                .lastModifiedTime(System.currentTimeMillis())
                .build());
    }

    /**
     * Best-available template identity for the dispatch-log row.
     *
     * <p>The authoritative value is the MDMS {@code RAINMAKER-PGR.NotificationTemplate}
     * uid — {@code audience.action.toState.channel.locale} — that PGR's
     * TemplateRenderer actually selected. pgr-services does NOT yet put it on the
     * wire: {@code NotificationService.publishRenderedEvent} must add an explicit
     * {@code templateKey} field to the pre-rendered event (carrying the locale it
     * actually rendered with, i.e. after any default-locale fallback). Until then
     * {@link ComplaintsDomainEvent#getTemplateKey()} is null and we reconstruct
     * the ROUTING key from segments the event already carries verbatim — audience
     * (contact.type), action/toState (event data block), channel and locale. This
     * matches the template uid except when the renderer fell back to its default
     * locale. Legacy envelopes without an action/toState fall back to the
     * eventName. Nothing here is fabricated: every segment comes from the event.
     */
    private String resolveTemplateKey(ComplaintsDomainEvent event, DerivedContext context) {
        if (StringUtils.hasText(event.getTemplateKey())) {
            return event.getTemplateKey();   // explicit wire value wins once PGR emits it
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
