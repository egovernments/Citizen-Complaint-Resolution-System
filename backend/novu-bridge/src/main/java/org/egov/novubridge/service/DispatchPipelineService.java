package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.provider.OzekiOverridesBuilder;
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
    private static final String OTP_EVENT_NAME = "OTP.SEND";

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final NovuClient novuClient;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;
    private final MdmsServiceClient mdmsServiceClient;
    private final DirectDeliveryService directDeliveryService;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   NovuClient novuClient,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config,
                                   MdmsServiceClient mdmsServiceClient,
                                   DirectDeliveryService directDeliveryService) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.novuClient = novuClient;
        this.dispatchLogRepository = dispatchLogRepository;
        this.config = config;
        this.mdmsServiceClient = mdmsServiceClient;
        this.directDeliveryService = directDeliveryService;
    }

    public DispatchResult process(ComplaintsDomainEvent event, boolean send, RequestInfo requestInfo) {
        log.info("Processing pre-rendered domain event: eventId={}, eventName={}, tenant={}, channel={}, send={}",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getChannel(), send);

        envelopeValidator.validate(event);

        // OTP.SEND (from otp-publisher) is a separate, minimal path — pre-account
        // (no DIGIT user yet), no PGR-rendered body/contact, delivered through the
        // existing complaints-sms workflow but (optionally) via an Ozeki override
        // instead of whatever's primary. Handle it before any of the PGR
        // pass-through logic (preference checks, contact building, WHATSAPP
        // formatting) that doesn't apply to it.
        if (OTP_EVENT_NAME.equalsIgnoreCase(event.getEventName())) {
            return processOtp(event, send);
        }

        DerivedContext context = deriveContext(event);
        String subscriberId = StringUtils.hasText(event.getSubscriberId())
                ? event.getSubscriberId()
                : context.getSubscriberId();
        if (!StringUtils.hasText(subscriberId)) {
            // A blank subscriberId is a pre-delivery validation-family rejection: throw
            // WITHOUT writing a dispatch-log row. This is the tested contract — see
            // EnvelopePipelineNegativesTest.assertRejected (verify(dispatchLogRepository,
            // never()).upsert(...)). Do NOT add a persist() here.
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

        // WhatsApp template gate: a business-initiated WhatsApp message MUST reference an approved
        // Twilio Content template (SID). PGR emits WHATSAPP events with a null templateId when no
        // approved NotificationProviderTemplate matched — persist an auditable SKIP here rather than
        // fall through to a free-form send, which Twilio rejects (63016). Bridge-side defense: hold
        // regardless of the producer.
        if ("WHATSAPP".equalsIgnoreCase(channel) && !StringUtils.hasText(event.getTemplateId())) {
            persist(event, context, "SKIPPED", "NB_TEMPLATE_NOT_APPROVED",
                    "No approved Twilio Content template for this WhatsApp event; free-form WhatsApp is "
                    + "rejected (63016). Map an approved template in NotificationProviderTemplate.", null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("WhatsApp event has no approved provider template; skipped"))
                    .build();
        }

        // WhatsApp recipient formatting: Twilio requires the recipient as `whatsapp:+<E164 digits>`.
        // PGR emits the phone as country-code + national number with no `+` and no `whatsapp:` prefix
        // (e.g. 254712345678), which Twilio rejects on delivery (63024). Mirror the working test-send
        // path (ProviderController: "whatsapp:+" + digitsOnly(phone)). digitsOnly strips any pre-existing
        // `+` or `whatsapp:` prefix, so this is idempotent (never double-prefixed). SMS and EMAIL are
        // left untouched — the country code was already prepended by PGR; the bridge only adds the prefix.
        if ("WHATSAPP".equalsIgnoreCase(channel) && StringUtils.hasText(contact.getPhone())) {
            contact.setPhone("whatsapp:+" + digitsOnly(contact.getPhone()));
        }

        // Determined once, before delivery, so both the success and failure paths below
        // (and their dispatch-log error code/message) agree on which gateway was actually used.
        boolean viaDirect = ("SMS".equalsIgnoreCase(channel) || "EMAIL".equalsIgnoreCase(channel))
                && config.isDirectChannel(channel);

        NovuClient.NovuResponse response;
        try {
            if ("SMS".equalsIgnoreCase(channel) && viaDirect) {
                response = directDeliveryService.sendSms(contact.getPhone(), context.getRenderedBody(), context.getTransactionId());
            } else if ("EMAIL".equalsIgnoreCase(channel) && viaDirect) {
                response = directDeliveryService.sendEmail(contact.getEmail(), context.getRenderedSubject(),
                        context.getRenderedBody(), context.getTransactionId());
            } else {
                // WHATSAPP always lands here, regardless of novu.bridge.direct.channels —
                // no generic WhatsApp gateway is wired here, and WhatsApp already requires
                // a Twilio-approved Content template, which is Novu/Twilio-specific.
                response = novuClient.identifyThenTrigger(
                        subscriberId, contact, channel,
                        context.getRenderedBody(), context.getRenderedSubject(),
                        context.getTransactionId(), event.getData(),
                        event.getTemplateId(), event.getContentVariables());
            }
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
            persist(event, context, "FAILED", viaDirect ? "NB_DIRECT_DELIVERY_FAILED" : "NB_NOVU_TRIGGER_FAILED",
                    (viaDirect ? "Direct delivery returned status " : "Novu returned status ") + sc,
                    response != null ? response.getResponse() : null, 1);
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

    /**
     * OTP send. otp-publisher carries the mobile number in {@code stakeholders[0]}
     * and the OTP code in {@code data.otp} — pre-account, so there is no
     * subscriberId/contact resolved by anything upstream the way PGR resolves
     * them for complaint events. Triggers the existing SMS pass-through workflow
     * ({@code novu.bridge.workflow.id.sms}, i.e. {@code complaints-sms}) — no
     * dedicated OTP workflow needed, since the workflow step is a bare
     * {@code payload.body} passthrough regardless of event type.
     *
     * <p>When {@code novu.bridge.otp.sms.provider=ozeki}, attaches the Ozeki
     * generic-sms overrides envelope ({@link OzekiOverridesBuilder}) so this one
     * trigger delivers via the (possibly non-primary) Ozeki integration instead
     * of whatever's primary for the sms channel — Twilio and PGR complaint
     * delivery are untouched either way, since this flag is only read here, not
     * in {@link #deriveContext} / the pass-through path above.
     */
    private DispatchResult processOtp(ComplaintsDomainEvent event, boolean send) {
        String mobile = (event.getStakeholders() != null && !event.getStakeholders().isEmpty())
                ? event.getStakeholders().get(0).getMobile() : null;
        Object otp = event.getData() != null ? event.getData().get("otp") : null;
        String transactionId = StringUtils.hasText(event.getTransactionId())
                ? event.getTransactionId() : event.getEventId();

        if (!StringUtils.hasText(mobile) || otp == null) {
            persistOtp(event, transactionId, "SKIPPED", "NB_OTP_CONTACT_MISSING",
                    "OTP event missing mobile or otp", 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).novuTriggered(false)
                    .diagnostics(Collections.singletonList("OTP event missing mobile or otp"))
                    .build();
        }

        if (!send) {
            persistOtp(event, transactionId, "RECEIVED", null, null, 1);
            return DispatchResult.builder()
                    .valid(true).preferenceAllowed(true).novuTriggered(false)
                    .diagnostics(Collections.singletonList("Validation only mode"))
                    .build();
        }

        String formattedMobile;
        try {
            // otp-publisher carries the bare national number (no "+"); prepend the
            // tenant's MDMS-configured country code the same way the PGR pass-through
            // path does in formatRecipientPhone, so Ozeki/Twilio get a real E.164
            // destination instead of a bare local number.
            formattedMobile = formatRecipientPhone(mobile, event.getTenantId(), "sms", null);
        } catch (CustomException ce) {
            persistOtp(event, transactionId, "FAILED", ce.getCode(), ce.getMessage(), 1);
            throw ce;
        }

        String subscriberId = event.getTenantId() + ":" + formattedMobile;
        String body = "Seu código de login de uso único é \"" + otp 
        + "\". Ele expira em 10 minutos. Não compartilhe este código.";
        Map<String, Object> payload = new HashMap<>();
        payload.put("otp", otp);
        payload.put("mobile", formattedMobile);
        payload.put("body", body);
        Object userType = event.getData() != null ? event.getData().get("userType") : null;
        if (userType != null) {
            payload.put("userType", userType);
        }

        Map<String, Object> overrides = config.isOtpOzekiEnabled()
                ? OzekiOverridesBuilder.build(config.getOzekiIntegrationIdentifier(), transactionId, formattedMobile, body)
                : null;

        // Determined once, before delivery, so the failure path's error code/message agrees
        // with which gateway was actually used.
        boolean viaDirect = config.isDirectChannel("SMS");

        NovuClient.NovuResponse response;
        try {
            // When SMS is direct, `overrides` (the Ozeki-via-Novu envelope built above from
            // config.isOtpOzekiEnabled()) simply goes unused — the two settings are
            // independent, non-conflicting ways to route SMS to Ozeki (via Novu, or not at all).
            response = viaDirect
                    ? directDeliveryService.sendSms(formattedMobile, body, transactionId)
                    : novuClient.trigger(config.getNovuWorkflowSms(), subscriberId, formattedMobile, payload, transactionId, overrides);
        } catch (CustomException ce) {
            persistOtp(event, transactionId, "FAILED", ce.getCode(), ce.getMessage(), 1);
            throw ce;
        }

        Integer sc = response != null ? response.getStatusCode() : null;
        boolean delivered = sc != null && sc >= 200 && sc < 300;
        persistOtp(event, transactionId, delivered ? "SENT" : "FAILED",
                delivered ? null : (viaDirect ? "NB_DIRECT_DELIVERY_FAILED" : "NB_NOVU_TRIGGER_FAILED"),
                delivered ? null : (viaDirect ? "Direct delivery returned status " : "Novu returned status ") + sc, 1);

        return DispatchResult.builder()
                .valid(true).preferenceAllowed(true)
                .novuTriggered(delivered).novuStatusCode(sc)
                .novuResponse(response != null ? response.getResponse() : null)
                .diagnostics(Collections.singletonList(
                        delivered ? "OTP dispatch successful" : "OTP dispatch failed: status " + sc))
                .build();
    }

    private void persistOtp(ComplaintsDomainEvent event, String transactionId, String status,
                            String errorCode, String errorMessage, Integer attemptCount) {
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(event.getEventId())
                .transactionId(transactionId)
                .referenceNumber(event.getEntityId())
                .module(event.getModule())
                .eventName(event.getEventName())
                .tenantId(event.getTenantId())
                .channel("SMS")
                .recipientValue(transactionId)
                .templateKey("OTP.SEND")
                .status(status)
                .attemptCount(attemptCount)
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .createdTime(System.currentTimeMillis())
                .lastModifiedTime(System.currentTimeMillis())
                .build());
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

    /** Strip everything but digits — mirrors ProviderController.digitsOnly so the real
     *  delivery path and the test-send path build the WhatsApp recipient identically. */
    private static String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D", "");
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
