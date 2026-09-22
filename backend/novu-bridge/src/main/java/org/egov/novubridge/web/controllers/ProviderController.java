package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.delivery.DeliveryProvider;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.DeliveryResult;
import org.egov.novubridge.service.delivery.Dispatch;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.service.provider.ProviderType;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.util.Values;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.ProviderCreateResponse;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.egov.novubridge.util.Values.asList;
import static org.egov.novubridge.util.Values.asMap;
import static org.egov.novubridge.util.Values.firstText;
import static org.egov.novubridge.util.Values.stableId;
import static org.egov.novubridge.util.Values.str;
import static org.egov.novubridge.util.Values.truthy;

/**
 * The configurator's Notification Providers screen, behind ProxyAuthFilter (create, _update and
 * _delete additionally need an admin role).
 *
 * <p>Secrets stay server-side: operator credentials go straight to Novu and are never persisted,
 * logged (key names only) or echoed. Every response goes through the {@link IntegrationProjection}
 * allowlist. Each write invalidates {@link ProviderAvailability} so dispatch sees it on the next event.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
@Slf4j
public class ProviderController {

    private static final String WORKFLOW_SMS = "complaints-sms";
    private static final String WORKFLOW_EMAIL = "complaints-email";

    private final NovuClient novuClient;
    private final DeliveryProviderRegistry providers;
    private final DispatchLogRepository dispatchLogRepository;
    private final TwilioTemplateSyncService twilioTemplateSyncService;
    private final ProviderCatalog catalog;
    private final ChannelPolicyClient channelPolicy;
    private final ProviderAvailability providerAvailability;

    public ProviderController(NovuClient novuClient,
                              DeliveryProviderRegistry providers,
                              DispatchLogRepository dispatchLogRepository,
                              TwilioTemplateSyncService twilioTemplateSyncService,
                              ProviderCatalog catalog,
                              ChannelPolicyClient channelPolicy,
                              ProviderAvailability providerAvailability) {
        this.novuClient = novuClient;
        this.providers = providers;
        this.dispatchLogRepository = dispatchLogRepository;
        this.twilioTemplateSyncService = twilioTemplateSyncService;
        this.catalog = catalog;
        this.channelPolicy = channelPolicy;
        this.providerAvailability = providerAvailability;
    }

    /** Provider types and their credential forms: what to ASK for, never what is stored. */
    @GetMapping("/providers/catalog")
    public ResponseEntity<Map<String, Object>> catalog() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", catalog.types());
        return ResponseEntity.ok(out);
    }

    /** The linked Twilio account's WhatsApp Content templates. Never returns credentials. */
    @GetMapping("/providers/twilio-templates")
    public ResponseEntity<Map<String, Object>> twilioTemplates() {
        return ResponseEntity.ok(twilioTemplateSyncService.syncWhatsappTemplates());
    }

    /**
     * Catalog form {@code {type, name, credentials, active?}}, or the legacy form
     * {@code {channel, providerId, name, identifier, credentials}} for a Novu provider the catalog
     * does not cover.
     */
    @PostMapping("/providers")
    public ResponseEntity<ProviderCreateResponse> createProvider(@RequestBody Map<String, Object> body) {
        if (StringUtils.hasText(str(body.get("type")))) {
            return createFromCatalog(body);
        }
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));
        String name = str(body.get("name"));
        String identifier = str(body.get("identifier"));
        if (!StringUtils.hasText(providerId)) {
            throw new CustomException("NB_INVALID_PROVIDER", "providerId is required");
        }
        String novuChannel = toNovuChannel(channel);
        // WHATSAPP is stored as a Novu `sms` integration; the identifier is the only round-trippable
        // field that can remember it was WhatsApp.
        if ("WHATSAPP".equalsIgnoreCase(channel) && !StringUtils.hasText(identifier)) {
            identifier = "whatsapp-" + stableId(StringUtils.hasText(name) ? name : providerId);
        }
        NovuClient.NovuResponse novuResponse =
                novuClient.createIntegration(name, identifier, providerId, novuChannel, asMap(body.get("credentials")));
        providerAvailability.invalidate();
        return projected(unwrapData(novuResponse.getResponse()));
    }

    /** The bridge resolves Novu provider id, channel, credential mapping and a typed identifier. */
    private ResponseEntity<ProviderCreateResponse> createFromCatalog(Map<String, Object> body) {
        ProviderType type = catalog.require(str(body.get("type")));
        Map<String, Object> credentials = asMap(body.get("credentials"));
        catalog.validateRequired(type, credentials);

        String name = StringUtils.hasText(str(body.get("name"))) ? str(body.get("name")) : type.getLabel();
        String identifier = StringUtils.hasText(str(body.get("identifier")))
                ? str(body.get("identifier"))
                : ProviderCatalog.identifierFor(type.getType(), name);
        // Absent means active: Novu's own default (inactive) would make it invisible to every trigger.
        boolean active = !body.containsKey("active") || truthy(body.get("active"));

        NovuClient.NovuResponse novuResponse = novuClient.createIntegration(
                name, identifier, type.getNovuProviderId(), type.novuChannel(),
                catalog.toNovuCredentials(type, credentials), active);
        providerAvailability.invalidate();
        return projected(unwrapData(novuResponse.getResponse()));
    }

    /**
     * Rename, toggle or rotate. The id is in the body because the gateway's access control matches
     * exact URLs. Novu REPLACES credentials wholesale on PUT, so a rotation is validated as complete
     * against the type derived from the integration's own identifier.
     */
    @PostMapping("/providers/_update")
    public ResponseEntity<ProviderCreateResponse> updateProvider(@RequestBody Map<String, Object> body) {
        String id = str(body.get("id"));
        if (!StringUtils.hasText(id)) {
            throw new CustomException("NB_INVALID_PROVIDER", "id is required");
        }
        Map<String, Object> existing = findIntegration(id);

        String name = str(body.get("name"));
        Boolean active = body.containsKey("active") ? truthy(body.get("active")) : null;
        Map<String, Object> credentials = asMap(body.get("credentials"));
        Map<String, Object> novuCredentials = null;
        if (credentials != null) {
            String derived = ProviderCatalog.deriveType(existing);
            if (derived == null) {
                throw new CustomException("NB_UNKNOWN_PROVIDER_TYPE",
                        "Cannot rotate credentials for integration " + id
                                + ": its provider type cannot be derived. Re-create it from the catalog.");
            }
            ProviderType type = catalog.require(derived);
            catalog.validateRequired(type, credentials);
            novuCredentials = catalog.toNovuCredentials(type, credentials);
        }
        // Novu answers an opaque 400 on an empty change set; name the accepted fields instead.
        if (!StringUtils.hasText(name) && novuCredentials == null && active == null) {
            throw new CustomException("NB_INVALID_PROVIDER",
                    "Nothing to update: supply at least one of name, credentials, active");
        }

        NovuClient.NovuResponse novuResponse =
                novuClient.updateIntegration(str(existing.get("_id")), name, novuCredentials, active);
        providerAvailability.invalidate();
        Map<String, Object> updated = unwrapData(novuResponse.getResponse());
        return projected(updated.isEmpty() ? existing : updated);
    }

    /**
     * Delete a provider and its Novu-held credentials, but never one a tenant still routes through:
     * Novu would delete it and every send on that channel would fail. 409 {@code NB_PROVIDER_IN_USE}.
     */
    @PostMapping("/providers/_delete")
    public ResponseEntity<Map<String, Object>> deleteProvider(@RequestBody Map<String, Object> body) {
        String id = str(body.get("id"));
        if (!StringUtils.hasText(id)) {
            throw new CustomException("NB_INVALID_PROVIDER", "id is required");
        }
        Map<String, Object> existing = findIntegration(id);
        String identifier = str(existing.get("identifier"));
        String tenantId = str(body.get("tenantId"));

        if (channelPolicy.isProviderInUse(tenantId, identifier)) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("code", "NB_PROVIDER_IN_USE");
            error.put("message", "Provider " + identifier + " is still selected on a NotificationChannel row"
                    + (StringUtils.hasText(tenantId) ? " for tenant " + tenantId : "")
                    + ". Point that channel at another provider first.");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("Errors", List.of(error));
            return new ResponseEntity<>(out, HttpStatus.CONFLICT);
        }

        novuClient.deleteIntegration(str(existing.get("_id")));
        providerAvailability.invalidate();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", id);
        data.put("deleted", true);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        return ResponseEntity.ok(out);
    }

    /** By Novu {@code _id} or {@code identifier}; Novu v2.3.0 has no GET-by-id, so this lists. */
    private Map<String, Object> findIntegration(String id) {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        for (Map<String, Object> i : IntegrationProjection.extractList(novuResponse.getResponse())) {
            if (id.equals(str(i.get("_id"))) || id.equals(str(i.get("identifier")))) {
                return i;
            }
        }
        throw new CustomException("NB_PROVIDER_NOT_FOUND", "No provider integration with id " + id);
    }

    /**
     * Novu workflows ({@code workflowId, name, channels}); does NOT call Twilio. {@code channel}
     * filters by step type; {@code providerId} is accepted but not filterable (workflows are
     * channel-scoped).
     */
    @GetMapping("/providers/templates")
    public ResponseEntity<Map<String, Object>> templates(
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String providerId) {
        NovuClient.NovuResponse novuResponse = novuClient.listWorkflows();
        List<Map<String, Object>> workflows = extractWorkflows(novuResponse.getResponse());
        String wantedStep = StringUtils.hasText(channel) ? toNovuChannel(channel) : null;
        List<Map<String, Object>> data = new ArrayList<>(workflows.size());
        for (Map<String, Object> wf : workflows) {
            List<String> steps = stepTypes(wf);
            // Older Novu omits stepTypeOverviews: degrade to the unfiltered list.
            if (wantedStep != null && !steps.isEmpty() && !steps.contains(wantedStep)) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("workflowId", wf.get("workflowId"));
            row.put("name", wf.get("name"));
            row.put("channels", steps);
            data.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        out.put("total", data.size());
        return ResponseEntity.ok(out);
    }

    private static List<String> stepTypes(Map<String, Object> workflow) {
        List<Object> raw = asList(workflow.get("stepTypeOverviews"));
        if (raw == null) {
            return List.of();
        }
        List<String> steps = new ArrayList<>();
        for (Object step : raw) {
            if (step != null) {
                steps.add(String.valueOf(step).toLowerCase());
            }
        }
        return steps;
    }

    /** {@code GET /v2/workflows} nests the list at {@code data.workflows}; tolerate {@code data} and {@code workflows}. */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> extractWorkflows(Map<String, Object> response) {
        if (response == null) {
            return List.of();
        }
        Map<String, Object> data = asMap(response.get("data"));
        if (data != null && data.get("workflows") instanceof List) {
            return (List<Map<String, Object>>) data.get("workflows");
        }
        if (response.get("data") instanceof List) {
            return (List<Map<String, Object>>) response.get("data");
        }
        if (response.get("workflows") instanceof List) {
            return (List<Map<String, Object>>) response.get("workflows");
        }
        return List.of();
    }

    /**
     * Is a configured integration present and active? Matched by {@code integrationId}/{@code id}
     * ({@code _id} or identifier), else by catalog {@code type}, else by {@code channel}+{@code providerId}.
     */
    @PostMapping("/providers/verify")
    public ResponseEntity<Map<String, Object>> verify(@RequestBody Map<String, Object> body) {
        String integrationId = firstText(str(body.get("integrationId")), str(body.get("id")));
        String type = str(body.get("type"));
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));

        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());
        String novuChannel = StringUtils.hasText(channel) ? toNovuChannel(channel) : null;
        Map<String, Object> match = null;
        for (Map<String, Object> i : integrations) {
            boolean hit;
            if (StringUtils.hasText(integrationId)) {
                hit = integrationId.equals(str(i.get("_id"))) || integrationId.equals(str(i.get("identifier")));
            } else if (StringUtils.hasText(type)) {
                hit = catalog.require(type).getType().equals(ProviderCatalog.deriveType(i));
            } else {
                hit = novuChannel != null && StringUtils.hasText(providerId)
                        && novuChannel.equalsIgnoreCase(str(i.get("channel")))
                        && providerId.equalsIgnoreCase(str(i.get("providerId")));
            }
            if (hit) {
                match = i;
                break;
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        if (match == null) {
            out.put("ok", false);
            out.put("active", false);
            out.put("detail", "no matching integration found");
        } else {
            boolean active = Boolean.TRUE.equals(match.get("active"));
            out.put("ok", active);
            out.put("active", active);
            out.put("detail", active ? "integration active" : "integration inactive");
        }
        return ResponseEntity.ok(out);
    }

    /**
     * A live test through the same provider seam as dispatch. The subscriberId is derived from the
     * input (no clock/random) so a re-test is reproducible. Writes one masked, {@code is_test} row
     * at the operator's tenant.
     */
    @PostMapping("/providers/test-send")
    public ResponseEntity<Map<String, Object>> testSend(@RequestBody Map<String, Object> body) {
        String channel = str(body.get("channel"));
        Map<String, Object> to = asMap(body.get("to"));
        String phone = to != null ? str(to.get("phone")) : null;
        String email = to != null ? str(to.get("email")) : null;
        String workflowId = str(body.get("workflowId"));
        String txnInput = str(body.get("transactionId"));
        String tenantId = StringUtils.hasText(str(body.get("tenantId"))) ? str(body.get("tenantId")) : "TEST";

        // `id` pins the trigger to one integration (and its type's gateway body); `type` alone fills in the channel.
        String integrationId = firstText(str(body.get("integrationId")), str(body.get("id")));
        String integrationIdentifier = null;
        String providerType = null;
        if (StringUtils.hasText(integrationId)) {
            Map<String, Object> integration = findIntegration(integrationId);
            integrationIdentifier = str(integration.get("identifier"));
            providerType = ProviderCatalog.deriveType(integration);
        }
        if (StringUtils.hasText(str(body.get("type")))) {
            ProviderType type = catalog.require(str(body.get("type")));
            providerType = type.getType();
            if (!StringUtils.hasText(channel)) {
                channel = type.getChannel();
            }
        }

        String upperChannel = channel == null ? "" : channel.toUpperCase();
        String recipient = StringUtils.hasText(phone) ? phone : email;
        String seed = StringUtils.hasText(txnInput) ? txnInput : (recipient != null ? recipient : upperChannel);
        String subscriberId = "nb-test-" + stableId(seed);
        String transactionId = StringUtils.hasText(txnInput) ? txnInput : subscriberId;
        String workflow = StringUtils.hasText(workflowId) ? workflowId
                : ("EMAIL".equals(upperChannel) ? WORKFLOW_EMAIL : WORKFLOW_SMS);

        Dispatch dispatch = Dispatch.builder()
                .test(true)
                .channel(upperChannel)
                .subscriberId(subscriberId)
                .contact(Contact.builder().phone(phone).email(email).build())
                .body(str(body.get("body")))
                .subject(str(body.get("subject")))
                .transactionId(transactionId)
                .templateId(str(body.get("contentSid")))
                .contentVariables(toContentVariables(asList(body.get("variables"))))
                .workflowOverride(workflow)
                .integrationIdentifier(integrationIdentifier)
                .providerType(providerType)
                .build();
        // A named integration is a Novu integration by construction (even SMSCountry, which is
        // generic-sms at our adapter), so the direct-gateway route must not swallow it.
        DeliveryProvider transport = StringUtils.hasText(integrationIdentifier)
                ? providers.novu() : providers.select(null, upperChannel);
        DeliveryResult result = transport.send(dispatch);

        int novuStatus = result.getStatusCode() != null ? result.getStatusCode() : 0;
        boolean ok = result.isAccepted();
        writeTestLog(tenantId, upperChannel, recipient, transactionId, novuStatus, ok, result);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", ok);
        out.put("novuStatus", novuStatus);
        out.put("transactionId", transactionId);
        if (!ok) {
            out.put("errorCode", result.getProviderCode());
            out.put("errorMessage", result.getProviderMessage());
        }
        return ResponseEntity.ok(out);
    }

    /** SMS and WHATSAPP to Novu {@code sms}; EMAIL to {@code email}; anything else is NB_INVALID_CHANNEL. */
    private static String toNovuChannel(String channel) {
        if (!StringUtils.hasText(channel)) {
            throw new CustomException("NB_INVALID_CHANNEL", "channel is required");
        }
        String novuChannel = Values.novuChannel(channel);
        if (novuChannel == null) {
            throw new CustomException("NB_INVALID_CHANNEL", "Unsupported channel: " + channel);
        }
        return novuChannel;
    }

    private static ResponseEntity<ProviderCreateResponse> projected(Map<String, Object> integration) {
        return new ResponseEntity<>(
                ProviderCreateResponse.builder().data(IntegrationProjection.projectListItem(integration)).build(),
                HttpStatus.OK);
    }

    /** Novu answers {@code {data:{...}}} or a bare object. */
    private static Map<String, Object> unwrapData(Map<String, Object> body) {
        if (body == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> data = asMap(body.get("data"));
        return data != null ? data : body;
    }

    /** Positional variables as Twilio's 1-based {@code {"1":..,"2":..}}. */
    private static Map<String, Object> toContentVariables(List<Object> variables) {
        if (variables == null || variables.isEmpty()) {
            return null;
        }
        Map<String, Object> cv = new LinkedHashMap<>();
        for (int i = 0; i < variables.size(); i++) {
            Object v = variables.get(i);
            cv.put(String.valueOf(i + 1), v == null ? "" : v.toString());
        }
        return cv;
    }

    private void writeTestLog(String tenantId, String channel, String recipient, String transactionId,
                              int novuStatus, boolean ok, DeliveryResult result) {
        long now = System.currentTimeMillis();
        Map<String, Object> providerResponse = new HashMap<>();
        providerResponse.put("test", true);
        providerResponse.put("novuStatus", novuStatus);
        if (result.getRawResponse() != null) providerResponse.put("provider", result.getRawResponse());
        dispatchLogRepository.upsert(DispatchLogEntry.builder()
                .id(UUID.randomUUID())
                .eventId(UUID.randomUUID().toString())
                .transactionId(transactionId)
                .module("notifications")
                .eventName("TEST")
                .tenantId(tenantId)
                .isTest(true)
                .providerRef(result.getProviderRef())
                .channel(StringUtils.hasText(channel) ? channel : "UNKNOWN")
                .recipientValue(recipient != null ? PiiMask.mask(recipient) : "unknown")
                .templateKey("TEST")
                .status(ok ? "SENT" : "FAILED")
                .lastErrorCode(ok ? null : result.getProviderCode())
                .lastErrorMessage(ok ? null : result.getProviderMessage())
                .attemptCount(1)
                .providerResponse(providerResponse)
                .createdTime(now)
                .lastModifiedTime(now)
                .build());
    }
}
