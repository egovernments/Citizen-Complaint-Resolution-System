package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
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
    private static final Pattern TWILIO_CONTENT_SID_PATTERN = Pattern.compile("^HX[a-fA-F0-9]{32}$");

    private final EnvelopeValidator envelopeValidator;
    private final PreferenceServiceClient preferenceServiceClient;
    private final UserServiceClient userServiceClient;
    private final ConfigServiceClient configServiceClient;
    private final NovuClient novuClient;
    private final DispatchLogRepository dispatchLogRepository;
    private final NovuBridgeConfiguration config;

    public DispatchPipelineService(EnvelopeValidator envelopeValidator,
                                   PreferenceServiceClient preferenceServiceClient,
                                   UserServiceClient userServiceClient,
                                   ConfigServiceClient configServiceClient,
                                   NovuClient novuClient,
                                   DispatchLogRepository dispatchLogRepository,
                                   NovuBridgeConfiguration config) {
        this.envelopeValidator = envelopeValidator;
        this.preferenceServiceClient = preferenceServiceClient;
        this.userServiceClient = userServiceClient;
        this.configServiceClient = configServiceClient;
        this.novuClient = novuClient;
        this.dispatchLogRepository = dispatchLogRepository;
        this.config = config;
    }

    public DispatchResult process(ComplaintsDomainEvent event, boolean send) {
        log.info("Processing domain event: eventId={}, eventName={}, tenant={}, module={}, send={}",
                event.getEventId(), event.getEventName(), event.getTenantId(), event.getModule(), send);

        envelopeValidator.validate(event);

        DerivedContext context = deriveContext(event);
        log.info("Derived context: eventId={}, audience={}, recipientMobile={}, recipientUserId={}, locale={}",
                event.getEventId(), context.getAudience(), context.getRecipientMobile(),
                context.getRecipientUserId(), context.getLocale());
        String recipientUuid = userServiceClient.resolveUserUuid(
                event.getTenantId(), context.getAudience(), context.getRecipientUserId(), context.getRecipientMobile());
        if (!StringUtils.hasText(recipientUuid)) {
            throw new CustomException("NB_RECIPIENT_UUID_MISSING", "Recipient user uuid could not be resolved");
        }
        context.setRecipientUserId(recipientUuid);
        String subscriberId = event.getTenantId() + ":" + recipientUuid;

        boolean preferenceAllowed = preferenceServiceClient.isWhatsAppAllowed(event.getTenantId(), recipientUuid, context.getRecipientMobile());
        if (!preferenceAllowed) {
            persist(event, context, null, "SKIPPED", "NB_PREFERENCE_DENIED", "WhatsApp preference denied", null, 1);
            return DispatchResult.builder()
                    .valid(true)
                    .preferenceAllowed(false)
                    .derivedContext(context)
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Preference denied"))
                    .build();
        }

        ResolvedTemplate resolvedTemplate = configServiceClient.resolveTemplate(context, event.getEventName(), event.getModule(), event.getTenantId());
        log.info("Resolved template: eventId={}, templateKey={}, contentSid={}, requiredVars={}, paramOrder={}",
                event.getEventId(), resolvedTemplate.getTemplateKey(), resolvedTemplate.getTwilioContentSid(),
                resolvedTemplate.getRequiredVars(), resolvedTemplate.getParamOrder());
        validateTemplateConfig(resolvedTemplate);
        
        // Resolve providers by channel only, then select by priority
        List<ResolvedProvider> availableProviders = configServiceClient.resolveProvidersByChannel(event.getTenantId(), context.getChannel());
        ResolvedProvider resolvedProvider = availableProviders.stream()
                .filter(ResolvedProvider::getIsActive)
                .sorted(Comparator.comparing(ResolvedProvider::getPriority))
                .findFirst()
                .orElseThrow(() -> new CustomException("NB_NO_ACTIVE_PROVIDER", 
                        "No active provider found for tenant=" + event.getTenantId() + " channel=" + context.getChannel()));
        
        log.info("Resolved provider: eventId={}, provider={}, channel={}, isActive={}, priority={}, credentialKeys={}, senderNumber={}, availableCount={}",
                event.getEventId(), resolvedProvider.getProviderName(), resolvedProvider.getChannel(),
                resolvedProvider.getIsActive(), resolvedProvider.getPriority(), 
                resolvedProvider.getCredentials() != null ? resolvedProvider.getCredentials().keySet() : "null",
                resolvedProvider.getSenderNumber(), availableProviders.size());
        
        // Provider is already filtered for active status above, no need to check again
        
        List<String> missingVars = findMissingRequiredVars(resolvedTemplate, event.getData());
        if (!missingVars.isEmpty()) {
            persist(event, context, resolvedTemplate, "FAILED", "NB_REQUIRED_VARS_MISSING", "Missing required vars", null, 1);
            return DispatchResult.builder()
                    .valid(false)
                    .preferenceAllowed(true)
                    .derivedContext(context)
                    .resolvedTemplate(resolvedTemplate)
                    .resolvedProvider(resolvedProvider)
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
                    .resolvedTemplate(resolvedTemplate)
                    .resolvedProvider(resolvedProvider)
                    .missingRequiredVars(Collections.emptyList())
                    .novuTriggered(false)
                    .diagnostics(Collections.singletonList("Validation only mode"))
                    .build();
        }

        String whatsappPhone = formatWhatsappPhone(context.getRecipientMobile());

        log.info("Dispatching notification: eventId={}, eventName={}, tenant={}, complaintNo={}, " +
                 "templateKey={}, subscriberId={}, phone={}, recipientMobile={}, provider={}, channel={}, senderNumber={}",
                event.getEventId(), event.getEventName(), event.getTenantId(),
                event.getData() != null ? event.getData().get("complaintNo") : "N/A",
                resolvedTemplate.getTemplateKey(), subscriberId, whatsappPhone,
                context.getRecipientMobile(), resolvedProvider.getProviderName(), resolvedProvider.getChannel(),
                resolvedProvider.getSenderNumber());
        log.info("Novu trigger payload: data={}, paramOrder={}, novuBaseUrl={}, providerCredentials={}",
                event.getData(), resolvedTemplate.getParamOrder(), config.getNovuBaseUrl(), 
                resolvedProvider.getCredentials() != null ? "[REDACTED]" : "null");

        // Use provider-specific Novu API key if available, otherwise use template-specific key
        String novuApiKey = resolvedProvider.getNovuApiKey() != null ? 
                resolvedProvider.getNovuApiKey() : resolvedTemplate.getNovuApiKey();

        // Use direct provider credential pass-through with sender number and contentSid from config
        NovuClient.NovuResponse novuResponse = novuClient.triggerWithProviderCredentials(
                resolvedTemplate.getTemplateKey(),
                subscriberId,
                whatsappPhone,
                event.getData(),
                event.getEventId(),
                resolvedProvider.getProviderName(),
                resolvedProvider.getCredentials(),
                resolvedProvider.getSenderNumber(),
                resolvedTemplate.getTwilioContentSid(),
                novuApiKey);

        log.info("Novu trigger response: eventId={}, statusCode={}, response={}",
                event.getEventId(), novuResponse.getStatusCode(), novuResponse.getResponse());

        persist(event, context, resolvedTemplate, "SENT", null, null, novuResponse.getResponse(), 1);
        return DispatchResult.builder()
                .valid(true)
                .preferenceAllowed(true)
                .derivedContext(context)
                .resolvedTemplate(resolvedTemplate)
                .resolvedProvider(resolvedProvider)
                .missingRequiredVars(Collections.emptyList())
                .novuTriggered(true)
                .novuStatusCode(novuResponse.getStatusCode())
                .novuResponse(novuResponse.getResponse())
                .diagnostics(Collections.singletonList("Dispatch successful"))
                .build();
    }

    public NovuClient.NovuResponse testTrigger(String templateKey, String subscriberId, String phone,
                                               Map<String, Object> payload, String transactionId,
                                               String contentSid, Map<String, String> contentVariables) {
        // Backward compatibility method for testing with Twilio-specific overrides
        return novuClient.trigger(
                templateKey,
                subscriberId,
                formatWhatsappPhone(phone),
                payload,
                transactionId,
                buildTwilioTemplateOverrides(contentSid, contentVariables));
    }

    private Map<String, Object> buildTwilioTemplateOverrides(ResolvedTemplate template, Map<String, Object> data) {
        String contentSid = resolveTwilioContentSid(template);
        if (!StringUtils.hasText(contentSid)) {
            return null;
        }
        validateTwilioContentSid(contentSid);

        List<String> orderedVars = template.getParamOrder();
        if (CollectionUtils.isEmpty(orderedVars)) {
            throw new CustomException("NB_TWILIO_PARAM_ORDER_REQUIRED",
                    "paramOrder is required when Twilio contentSid is configured");
        }

        Map<String, String> contentVariables = new LinkedHashMap<>();
        int idx = 1;
        for (String key : orderedVars) {
            Object value = data != null ? data.get(key) : null;
            contentVariables.put(String.valueOf(idx++), value == null ? "" : String.valueOf(value));
        }
        return buildTwilioTemplateOverrides(contentSid, contentVariables);
    }

    private Map<String, Object> buildTwilioTemplateOverrides(String contentSid, Map<String, String> contentVariables) {
        if (!StringUtils.hasText(contentSid)) {
            return null;
        }
        validateTwilioContentSid(contentSid);

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

    private String formatWhatsappPhone(String mobile) {
        if (!StringUtils.hasText(mobile)) {
            return null;
        }
        String normalized = mobile.trim();
        if (normalized.startsWith("whatsapp:")) {
            return normalized;
        }
        if (normalized.startsWith("+")) {
            return "whatsapp:" + normalized;
        }
        // Assume Indian number if no country code — prepend +91
        if (normalized.matches("^[6-9]\\d{9}$")) {
            return "whatsapp:+91" + normalized;
        }
        return "whatsapp:+" + normalized;
    }

    private DerivedContext deriveContext(ComplaintsDomainEvent event) {
        Stakeholder stakeholder = null;
        if (!CollectionUtils.isEmpty(event.getStakeholders())) {
            stakeholder = event.getStakeholders().stream()
                    .filter(s -> StringUtils.hasText(s.getMobile()))
                    .findFirst()
                    .orElse(event.getStakeholders().get(0));
        }

        return DerivedContext.builder()
                .channel(config.getChannel())
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
        String contentSid = resolveTwilioContentSid(template);
        if (StringUtils.hasText(contentSid) && !CollectionUtils.isEmpty(template.getParamOrder())) {
            requiredVars.addAll(template.getParamOrder());
        }

        for (String requiredVar : requiredVars) {
            if (data == null || !data.containsKey(requiredVar) || data.get(requiredVar) == null) {
                missing.add(requiredVar);
            }
        }
        return missing;
    }

    private void validateTemplateConfig(ResolvedTemplate template) {
        String contentSid = resolveTwilioContentSid(template);
        if (!StringUtils.hasText(contentSid)) {
            return;
        }
        validateTwilioContentSid(contentSid);
        if (CollectionUtils.isEmpty(template.getParamOrder())) {
            throw new CustomException("NB_TWILIO_PARAM_ORDER_REQUIRED",
                    "paramOrder is required when Twilio contentSid is configured");
        }
    }

    private void validateTwilioContentSid(String contentSid) {
        if (!TWILIO_CONTENT_SID_PATTERN.matcher(contentSid).matches()) {
            throw new CustomException("NB_TWILIO_CONTENT_SID_INVALID",
                    "Invalid Twilio contentSid format; expected HX followed by 32 hex chars");
        }
    }

    private String resolveTwilioContentSid(ResolvedTemplate template) {
        if (StringUtils.hasText(template.getTwilioContentSid())) {
            return template.getTwilioContentSid();
        }
        // Backward compatibility for current config where templateVersion carries contentSid.
        if (StringUtils.hasText(template.getTemplateVersion()) && template.getTemplateVersion().startsWith("HX")) {
            return template.getTemplateVersion();
        }
        return null;
    }

    private void persist(ComplaintsDomainEvent event, DerivedContext context, ResolvedTemplate template,
                         String status, String errorCode, String errorMessage,
                         Map<String, Object> providerResponse, Integer attemptCount) {
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .eventId(event.getEventId())
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
