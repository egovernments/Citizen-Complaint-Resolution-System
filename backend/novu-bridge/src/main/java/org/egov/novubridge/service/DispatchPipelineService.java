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

import java.util.regex.Pattern;
import java.util.*;

@Service
@Slf4j
public class DispatchPipelineService {
    private static final Pattern TWILIO_CONTENT_SID_PATTERN = Pattern.compile("^[Hh][Xx][a-fA-F0-9]{32}$");

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final UserServiceClient userServiceClient;
    private final ConfigServiceClient configServiceClient;
    private final NovuClient novuClient;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;
    private final MdmsServiceClient mdmsServiceClient;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   UserServiceClient userServiceClient,
                                   ConfigServiceClient configServiceClient,
                                   NovuClient novuClient,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config,
                                   MdmsServiceClient mdmsServiceClient) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.userServiceClient = userServiceClient;
        this.configServiceClient = configServiceClient;
        this.novuClient = novuClient;
        this.dispatchLogRepository = dispatchLogRepository;
        this.config = config;
        this.mdmsServiceClient = mdmsServiceClient;
    }

    /**
     * Multi-channel entry point used by the Kafka consumer. Resolves the channels the tenant has
     * enabled (intersected with the global allow-list) and dispatches the event on each, isolating
     * per-channel failures so one misconfigured channel never blocks the others. Returns one
     * DispatchResult per channel (empty list when the tenant has no enabled+allowed channels).
     */
    public List<DispatchResult> processEnabledChannels(ComplaintsDomainEvent event, boolean send, RequestInfo requestInfo) {
        log.info("Processing domain event (multi-channel): eventId={}, eventName={}, tenant={}, module={}, send={}",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getModule(), send);

        envelopeValidator.validate(event);

        List<String> effective = effectiveChannels(event.getTenantId());
        if (effective.isEmpty()) {
            log.info("No effective channels for tenant={}, eventId={}; nothing dispatched",
                    event.getTenantId(), event.getEventId());
            return Collections.emptyList();
        }

        DerivedContext base = deriveContext(event);
        String subscriberId = prepareRecipient(event, base);

        log.info("Dispatching eventId={} on channels={}", event.getEventId(), effective);
        List<DispatchResult> results = new ArrayList<>();
        for (String channel : effective) {
            DerivedContext context = base.toBuilder().channel(channel).build();
            results.add(dispatchForChannel(event, context, subscriberId, send, requestInfo));
        }
        return results;
    }

    /**
     * Single-channel entry point used by the diagnostic controller endpoints (_validate / _dry-run).
     * Targets the primary allowed channel and keeps the tenant-level enable gate (default OFF).
     */
    public DispatchResult process(ComplaintsDomainEvent event, boolean send, RequestInfo requestInfo) {
        log.info("Processing domain event (single-channel): eventId={}, eventName={}, tenant={}, module={}, send={}",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getModule(), send);

        envelopeValidator.validate(event);

        String channel = primaryChannel();
        DerivedContext context = deriveContext(event);
        context.setChannel(channel);
        log.info("Derived context: eventId={}, channel={}, audience={}, recipientMobile={}, recipientUserId={}, locale={}",
                event.getEventId(), channel, context.getAudience(), context.getRecipientMobile(),
                context.getRecipientUserId(), context.getLocale());

        // Tenant-level channel gate. The channel is dispatched when the tenant has enabled it, or when
        // the tenant has no NotificationChannel config at all (legacy fallback, see effectiveChannels).
        // This is also the diagnostic path (_validate/_dry-run): a config-service failure must not 500
        // the endpoint, so report it as a diagnostic result instead of letting it throw.
        List<String> effective;
        try {
            effective = effectiveChannels(event.getTenantId());
        } catch (CustomException e) {
            return DispatchResult.builder()
                    .valid(false)
                    .preferenceAllowed(false)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Channel config unavailable: " + e.getCode()))
                    .build();
        }
        if (!effective.contains(channel)) {
            // Only record a SKIPPED dispatch-log row when actually sending; _validate must be side-effect-free.
            if (send) {
                persist(event, context, null, "SKIPPED", "NB_CHANNEL_DISABLED",
                        channel + " channel not enabled for tenant " + event.getTenantId(), null, 1);
            }
            return DispatchResult.builder()
                    .valid(true)
                    .preferenceAllowed(false)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Channel not enabled for tenant"))
                    .build();
        }

        String subscriberId = prepareRecipient(event, context);
        return dispatchForChannel(event, context, subscriberId, send, requestInfo);
    }

    /**
     * Channel-independent recipient + locale resolution. Mutates the given context with the resolved
     * recipient uuid and preferred locale, and returns the Novu subscriberId. Throws (propagating to
     * the consumer's DLQ path) when the recipient cannot be resolved — this is fatal for all channels.
     */
    private String prepareRecipient(ComplaintsDomainEvent event, DerivedContext context) {
        String recipientUuid = userServiceClient.resolveUserUuid(
                event.getTenantId(), context.getAudience(), context.getRecipientUserId(), context.getRecipientMobile());
        if (!StringUtils.hasText(recipientUuid)) {
            throw new CustomException("NB_RECIPIENT_UUID_MISSING", "Recipient user uuid could not be resolved");
        }
        context.setRecipientUserId(recipientUuid);
        String subscriberId = event.getTenantId() + ":" + recipientUuid;

        String userPreferredLocale = preferenceServiceClient.getUserPreferredLocale(event.getTenantId(), recipientUuid, context.getLocale());
        context.setLocale(userPreferredLocale);
        log.info("Recipient prepared: eventId={}, userId={}, locale={}", event.getEventId(), recipientUuid, userPreferredLocale);
        return subscriberId;
    }

    /**
     * Dispatches a single channel for an event whose recipient/locale have already been resolved on
     * {@code context}. Per-channel failures are caught and recorded as FAILED so a misconfigured
     * channel never aborts sibling channels; only unexpected (non-CustomException) errors bubble up.
     */
    private DispatchResult dispatchForChannel(ComplaintsDomainEvent event, DerivedContext context,
                                              String subscriberId, boolean send, RequestInfo requestInfo) {
        String channel = context.getChannel();
        try {
            boolean preferenceAllowed = preferenceServiceClient.isChannelAllowed(
                    event.getTenantId(), context.getRecipientUserId(), context.getRecipientMobile(), channel);
            if (!preferenceAllowed) {
                persist(event, context, null, "SKIPPED", "NB_PREFERENCE_DENIED", channel + " preference denied", null, 1);
                return DispatchResult.builder()
                        .valid(true)
                        .preferenceAllowed(false)
                        .derivedContext(context)
                        .novuTriggered(false)
                        .diagnostics(Collections.singletonList("Preference denied"))
                        .build();
            }

            ResolvedTemplate resolvedTemplate = configServiceClient.resolveTemplate(context, event.getEventName(), event.getModule(), event.getTenantId());
            log.info("Resolved template: eventId={}, channel={}, templateKey={}, contentSid={}, requiredVars={}, paramOrder={}",
                    event.getEventId(), channel, resolvedTemplate.getTemplateKey(), resolvedTemplate.getContentSid(),
                    resolvedTemplate.getRequiredVars(), resolvedTemplate.getParamOrder());
            validateTemplateConfig(resolvedTemplate);

            // Resolve providers by channel with priority=1, pick the first one
            List<ResolvedProvider> availableProviders = configServiceClient.resolveProvidersByChannel(event.getTenantId(), channel);
            if (availableProviders.isEmpty()) {
                throw new CustomException("NB_NO_ACTIVE_PROVIDER",
                        "No provider found with priority 1 for tenant=" + event.getTenantId() + " channel=" + channel);
            }
            ResolvedProvider resolvedProvider = availableProviders.get(0);

            log.info("Resolved provider: eventId={}, channel={}, provider={}, isActive={}, priority={}, credentialKeys={}, senderNumber={}, availableCount={}",
                    event.getEventId(), channel, resolvedProvider.getProviderName(),
                    resolvedProvider.getIsActive(), resolvedProvider.getPriority(),
                    resolvedProvider.getCredentials() != null ? resolvedProvider.getCredentials().keySet() : "null",
                    resolvedProvider.getSenderNumber(), availableProviders.size());

            List<String> missingVars = findMissingRequiredVars(resolvedTemplate, event.getData());
            if (!missingVars.isEmpty()) {
                persist(event, context, resolvedTemplate, "FAILED", "NB_REQUIRED_VARS_MISSING", "Missing required vars", null, 1);
                return DispatchResult.builder()
                        .valid(false)
                        .preferenceAllowed(true)
                        .derivedContext(context)
                        .resolvedTemplate(ResolvedTemplateResponse.fromInternal(resolvedTemplate))
                        .resolvedProvider(ResolvedProviderResponse.fromInternal(resolvedProvider))
                        .missingRequiredVars(missingVars)
                        .novuTriggered(false)
                        .diagnostics(Collections.singletonList("Missing required vars"))
                        .build();
            }

            if (!send) {
                persist(event, context, resolvedTemplate, "RECEIVED", null, null, null, 1);
                return DispatchResult.builder()
                        .valid(true)
                        .preferenceAllowed(true)
                        .derivedContext(context)
                        .resolvedTemplate(ResolvedTemplateResponse.fromInternal(resolvedTemplate))
                        .resolvedProvider(ResolvedProviderResponse.fromInternal(resolvedProvider))
                        .missingRequiredVars(Collections.emptyList())
                        .novuTriggered(false)
                        .diagnostics(Collections.singletonList("Validation only mode"))
                        .build();
            }

            String recipientPhone = formatRecipientPhone(context.getRecipientMobile(), event.getTenantId(), channel, requestInfo);

            log.info("Dispatching notification: eventId={}, eventName={}, tenant={}, channel={}, complaintNo={}, " +
                     "templateKey={}, subscriberId={}, provider={}, senderNumber={}",
                    event.getEventId(), event.getEventName(), event.getTenantId(), channel,
                    event.getData() != null ? event.getData().get("complaintNo") : "N/A",
                    resolvedTemplate.getTemplateKey(), subscriberId,
                    resolvedProvider.getProviderName(), resolvedProvider.getSenderNumber());
            log.info("Novu trigger payload: paramOrder={}, novuBaseUrl={}, providerCredentials={}",
                    resolvedTemplate.getParamOrder(), config.getNovuBaseUrl(),
                    resolvedProvider.getCredentials() != null ? "[REDACTED]" : "null");

            // Use provider-specific Novu API key if available and not blank, otherwise use template-specific key
            String novuApiKey = StringUtils.hasText(resolvedProvider.getNovuApiKey()) ?
                    resolvedProvider.getNovuApiKey() : resolvedTemplate.getNovuApiKey();

            // Build ordered content variables for template if paramOrder is configured
            Map<String, String> contentVariables = null;
            if (!CollectionUtils.isEmpty(resolvedTemplate.getParamOrder()) &&
                StringUtils.hasText(resolvedTemplate.getContentSid())) {
                contentVariables = buildOrderedContentVariables(resolvedTemplate, event.getData());
                log.info("Built ordered content variables from paramOrder: {}", contentVariables);
            }

            // Use provider-agnostic notification dispatch with automatic strategy selection
            NovuClient.NovuResponse novuResponse = novuClient.triggerWithProviderConfig(
                    resolvedTemplate.getTemplateKey(),
                    subscriberId,
                    recipientPhone,
                    event.getData(),
                    event.getEventId(),
                    resolvedProvider,
                    resolvedTemplate,
                    contentVariables,
                    novuApiKey);

            log.info("Novu trigger response: eventId={}, channel={}, statusCode={}, response={}",
                    event.getEventId(), channel, novuResponse.getStatusCode(), novuResponse.getResponse());

            persist(event, context, resolvedTemplate, "SENT", null, null, novuResponse.getResponse(), 1);
            return DispatchResult.builder()
                    .valid(true)
                    .preferenceAllowed(true)
                    .derivedContext(context)
                    .resolvedTemplate(ResolvedTemplateResponse.fromInternal(resolvedTemplate))
                    .resolvedProvider(ResolvedProviderResponse.fromInternal(resolvedProvider))
                    .missingRequiredVars(Collections.emptyList())
                    .novuTriggered(true)
                    .novuStatusCode(novuResponse.getStatusCode())
                    .novuResponse(novuResponse.getResponse())
                    .diagnostics(Collections.singletonList("Dispatch successful"))
                    .build();
        } catch (Exception e) {
            // Isolate ALL per-channel failures (not just CustomException): record FAILED and let sibling
            // channels proceed. Catching broadly is deliberate — letting an unexpected error bubble would
            // re-queue the whole event for retry and re-send channels that already succeeded (duplicates).
            String code = (e instanceof CustomException) ? ((CustomException) e).getCode() : "NB_DISPATCH_ERROR";
            log.error("Dispatch failed for eventId={} channel={} code={}", event.getEventId(), channel, code, e);
            persist(event, context, null, "FAILED", code, e.getMessage(), null, 1);
            return DispatchResult.builder()
                    .valid(false)
                    .preferenceAllowed(true)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList(channel + " failed: " + code))
                    .build();
        }
    }

    private String primaryChannel() {
        List<String> allowed = config.getAllowedChannels();
        return allowed.isEmpty() ? config.getChannel() : allowed.get(0);
    }

    /**
     * The channels to dispatch on for a tenant: the explicitly-enabled NotificationChannel codes
     * intersected with the global allow-list, OR — when the tenant has no NotificationChannel config
     * at all — the full allow-list (legacy back-compat, so existing tenants keep working with no
     * backfill). A tenant that has config but has disabled everything dispatches on nothing.
     */
    private List<String> effectiveChannels(String tenantId) {
        List<String> allowed = config.getAllowedChannels();
        List<String> configured = configServiceClient.getEnabledChannels(tenantId); // null => unconfigured
        if (configured == null) {
            return allowed;
        }
        return configured.stream()
                .filter(allowed::contains)
                .distinct()
                .collect(java.util.stream.Collectors.toList());
    }

    public NovuClient.NovuResponse testTrigger(String templateKey, String subscriberId, String phone,
                                               Map<String, Object> payload, String transactionId,
                                               String contentSid, Map<String, String> contentVariables,RequestInfo requestInfo) {
        // Backward compatibility method for testing with Twilio-specific overrides
        return novuClient.trigger(
                templateKey,
                subscriberId,
                formatRecipientPhone(phone, null, primaryChannel(), requestInfo),
                payload,
                transactionId,
                buildTemplateOverrides(contentSid, contentVariables));
    }

    private Map<String, String> buildOrderedContentVariables(ResolvedTemplate template, Map<String, Object> data) {
        List<String> orderedVars = template.getParamOrder();
        if (CollectionUtils.isEmpty(orderedVars)) {
            throw new CustomException("NB_PARAM_ORDER_REQUIRED",
                    "paramOrder is required when template has ordered parameters");
        }

        Map<String, String> contentVariables = new LinkedHashMap<>();
        int idx = 1;
        for (String key : orderedVars) {
            Object value = data != null ? data.get(key) : null;
            contentVariables.put(String.valueOf(idx++), value == null ? "" : String.valueOf(value));
        }
        return contentVariables;
    }


    private Map<String, Object> buildTemplateOverrides(String contentSid, Map<String, String> contentVariables) {
        if (!StringUtils.hasText(contentSid)) {
            return null;
        }
        validateContentSid(contentSid);

        // Novu passthrough uses camelCase; contentVariables must be a JSON string for Twilio
        Map<String, Object> body = new HashMap<>();
        body.put("contentSid", contentSid);
        try {
            String cvJson = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsString(contentVariables == null ? Collections.emptyMap() : contentVariables);
            body.put("contentVariables", cvJson);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new CustomException("NB_CONTENT_VARS_SERIALIZE", "Failed to serialize contentVariables to JSON");
        }

        Map<String, Object> passthrough = new HashMap<>();
        passthrough.put("body", body);

        Map<String, Object> twilio = new HashMap<>();
        twilio.put("_passthrough", passthrough);

        Map<String, Object> providers = new HashMap<>();
        providers.put("twilio", twilio);

        Map<String, Object> overrides = new HashMap<>();
        overrides.put("providers", providers);
        return overrides;
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
            if (!normalized.matches(validationConfig.getPattern())) {
                throw new CustomException("INVALID_MOBILE_NUMBER",
                        "Mobile number is not matching with default mobile pattern in MDMS");
            }
            e164 = validationConfig.getPrefix() + normalized;
        }

        // Twilio Programmable WhatsApp requires the `whatsapp:` prefix on the
        // recipient address; SMS / Vonage / Value-First / WhatsApp Business
        // API all take raw E.164. Keying off the dispatch channel keeps SMS
        // routes from being silently shunted into Twilio's WhatsApp pipeline.
        return isWhatsapp ? "whatsapp:" + e164 : e164;
    }

    private DerivedContext deriveContext(ComplaintsDomainEvent event) {
        Stakeholder stakeholder = null;
        if (!CollectionUtils.isEmpty(event.getStakeholders())) {
            stakeholder = event.getStakeholders().stream()
                    .filter(s -> StringUtils.hasText(s.getMobile()))
                    .findFirst()
                    .orElse(event.getStakeholders().get(0));
        }

        // Channel is intentionally left unset here; it is assigned per dispatch
        // (single channel in process(), one per enabled channel in processEnabledChannels()).
        return DerivedContext.builder()
                .audience(stakeholder != null ? stakeholder.getType() : null)
                .workflowState(event.getWorkflow() != null ? event.getWorkflow().getToState() : null)
                .locale(event.getContext() != null && StringUtils.hasText(event.getContext().getLocale()) ? event.getContext().getLocale() : config.getDefaultLocale())
                .recipientMobile(stakeholder != null ? stakeholder.getMobile() : null)
                .recipientUserId(stakeholder != null ? stakeholder.getUserId() : null)
                .build();
    }

    private List<String> findMissingRequiredVars(ResolvedTemplate template, Map<String, Object> data) {
        List<String> missing = new ArrayList<>();
        Set<String> requiredVars = new LinkedHashSet<>();
        if (!CollectionUtils.isEmpty(template.getRequiredVars())) {
            requiredVars.addAll(template.getRequiredVars());
        }
        String contentSid = resolveContentSid(template);
        if (StringUtils.hasText(contentSid) && !CollectionUtils.isEmpty(template.getParamOrder())) {
            requiredVars.addAll(template.getParamOrder());
        }

        log.info("Checking required vars: template={}, requiredVars={}, availableData={}", 
                template.getTemplateKey(), requiredVars, data != null ? data.keySet() : "null");

        for (String requiredVar : requiredVars) {
            if (data == null || !data.containsKey(requiredVar) || data.get(requiredVar) == null) {
                log.warn("Missing required variable: var={}, dataNull={}, containsKey={}, valueNull={}", 
                        requiredVar, data == null, data != null && data.containsKey(requiredVar), 
                        data != null && data.containsKey(requiredVar) ? data.get(requiredVar) == null : "N/A");
                missing.add(requiredVar);
            }
        }
        
        if (!missing.isEmpty()) {
            log.error("Missing required variables detected: missing={}, template={}, eventData={}", 
                    missing, template.getTemplateKey(), data);
        }
        
        return missing;
    }

    private void validateTemplateConfig(ResolvedTemplate template) {
        String contentSid = resolveContentSid(template);
        if (!StringUtils.hasText(contentSid)) {
            return;
        }
        validateContentSid(contentSid);
        if (CollectionUtils.isEmpty(template.getParamOrder())) {
            throw new CustomException("NB_PARAM_ORDER_REQUIRED",
                    "paramOrder is required when contentSid is configured");
        }
    }

    private void validateContentSid(String contentSid) {
        // Support Twilio format (HX + 32 hex chars) for backward compatibility
        // Other providers can have different formats - just check it's not empty
        if (!StringUtils.hasText(contentSid)) {
            throw new CustomException("NB_CONTENT_SID_INVALID", "ContentSid cannot be empty");
        }
        // If it looks like Twilio format, validate accordingly
        if (contentSid.startsWith("HX") || contentSid.startsWith("hx")) {
            if (!TWILIO_CONTENT_SID_PATTERN.matcher(contentSid).matches()) {
                throw new CustomException("NB_CONTENT_SID_INVALID",
                        "Invalid Twilio contentSid format; expected HX followed by 32 hex chars");
            }
        }
        // Other providers: accept any non-empty string as valid
    }

    private String resolveContentSid(ResolvedTemplate template) {
        if (StringUtils.hasText(template.getContentSid())) {
            return template.getContentSid();
        }
        // Backward compatibility for current config where templateVersion carries contentSid.
        if (StringUtils.hasText(template.getTemplateVersion()) && 
            (template.getTemplateVersion().startsWith("HX") || template.getTemplateVersion().startsWith("hx"))) {
            return template.getTemplateVersion();
        }
        return null;
    }

    private void persist(ComplaintsDomainEvent event, DerivedContext context, ResolvedTemplate template,
                         String status, String errorCode, String errorMessage,
                         Map<String, Object> providerResponse, Integer attemptCount) {
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(event.getEventId())
                .referenceNumber(event.getEntityId())
                .module(event.getModule())
                .eventName(event.getEventName())
                .tenantId(event.getTenantId())
                .channel(context.getChannel())
                .recipientValue(context.getRecipientUserId())
                .templateKey(template != null ? template.getTemplateKey() : null)
                .templateVersion(template != null ? template.getTemplateVersion() : null)
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
