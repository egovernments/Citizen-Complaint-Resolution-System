package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
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
 *   <li>delivers the rendered body — via Novu for SMS/EMAIL, via the Baileys
 *       send-service for WHATSAPP — and</li>
 *   <li>records the result in {@code nb_dispatch_log} keyed by transactionId.</li>
 * </ol>
 */
@Service
@Slf4j
public class DispatchPipelineService {

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final NovuClient novuClient;
    private final BaileysSendClient baileysSendClient;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;
    private final MdmsServiceClient mdmsServiceClient;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   NovuClient novuClient,
                                   BaileysSendClient baileysSendClient,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config,
                                   MdmsServiceClient mdmsServiceClient) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.novuClient = novuClient;
        this.baileysSendClient = baileysSendClient;
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
            throw new CustomException("NB_SUBSCRIBER_ID_MISSING",
                    "subscriberId is required (PGR resolved it; null means a bad event)");
        }
        context.setSubscriberId(subscriberId);

        log.info("Derived context: eventId={}, channel={}, subscriberId={}, recipientPhone={}, email={}, locale={}",
                event.getEventId(), context.getChannel(), subscriberId,
                context.getRecipientMobile(), context.getEmail(), context.getLocale());

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

        Contact contact = buildContact(event, context);
        String channel = context.getChannel();
        NovuClient.NovuResponse response;

        if ("WHATSAPP".equalsIgnoreCase(channel)) {
            // WhatsApp is delivered out-of-band via Baileys; strip the Twilio
            // "whatsapp:" prefix so Baileys receives a bare E.164 MSISDN.
            String to = formatRecipientPhone(context.getRecipientMobile(), event.getTenantId(), "sms", requestInfo);
            log.info("Routing WHATSAPP via Baileys: eventId={}, to={}, txn={}",
                    event.getEventId(), to, context.getTransactionId());
            response = baileysSendClient.send(to, context.getRenderedBody());
        } else {
            // SMS / EMAIL: identify the subscriber then trigger the per-channel Novu workflow.
            response = novuClient.identifyThenTrigger(
                    subscriberId,
                    contact,
                    channel,
                    context.getRenderedBody(),
                    context.getRenderedSubject(),
                    context.getTransactionId(),
                    event.getData());
        }

        log.info("Dispatch response: eventId={}, channel={}, statusCode={}, txn={}",
                event.getEventId(), channel,
                response != null ? response.getStatusCode() : null, context.getTransactionId());

        persist(event, context, "SENT", null, null,
                response != null ? response.getResponse() : null, 1);
        return DispatchResult.builder()
                .valid(true)
                .preferenceAllowed(true)
                .derivedContext(context)
                .novuTriggered(true)
                .novuStatusCode(response != null ? response.getStatusCode() : null)
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
                throw new CustomException("INVALID_MOBILE_NUMBER",
                        "Mobile number does not match the configured pattern for tenantId=" + tenantId);
            }
            e164 = validationConfig.getCountryCode() + normalized;
        }

        // Twilio Programmable WhatsApp requires the `whatsapp:` prefix; SMS and
        // the Baileys path take raw E.164. The WHATSAPP-via-Baileys route in
        // process() passes channel="sms" here precisely to get bare E.164.
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
                .status(status)
                .attemptCount(attemptCount)
                .lastErrorCode(errorCode)
                .lastErrorMessage(errorMessage)
                .providerResponse(providerResponse)
                .createdTime(System.currentTimeMillis())
                .lastModifiedTime(System.currentTimeMillis())
                .build());
    }
}
