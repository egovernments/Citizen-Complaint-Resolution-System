package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.delivery.DeliveryProvider;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.DeliveryResult;
import org.egov.novubridge.service.delivery.Dispatch;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.service.provider.ProviderType;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.util.PiiMask;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Self-service provider management for the configurator's Notification Providers
 * screen. Sits alongside {@link IntegrationController} and {@code DispatchController}
 * under the same {@code /novu-adapter/v1} namespace, behind the same
 * {@link org.egov.novubridge.web.filters.ProxyAuthFilter} EMPLOYEE+role gate. The three
 * management calls here that carry credentials or destroy them ({@code POST /providers},
 * {@code /providers/_update}, {@code /providers/_delete}) additionally require a role from
 * {@code novu.bridge.proxy.admin.roles}; the filter refuses the rest with 403
 * {@code NB_ADMIN_ROLE_REQUIRED} before this class is reached.
 *
 * <p>Each of those three also invalidates {@link ProviderAvailability}, so the dispatch
 * pipeline's "is the chosen provider usable" check sees an operator's change on the very next
 * event instead of up to a cache TTL later.
 *
 * <p><b>Secrets stay server-side.</b> Novu is the provider/credential store; this
 * service holds only the Novu ApiKey (never exposed to the keyless SPA). Operator
 * credentials entered in the UI POST straight through to Novu over TLS via
 * {@link NovuClient#createIntegration}; they are never persisted here, never logged
 * (only credential key names are), and never echoed back — every response is built
 * by the shared {@link IntegrationProjection} ALLOWLIST (no {@code credentials} key
 * in any shape ever leaves). There is deliberately NO endpoint that returns a raw
 * provider secret or the Novu key.
 *
 * <p>Every {@code /providers/test-send} writes one {@code nb_dispatch_log} row at the
 * operator's tenant flagged {@code is_test} (event_name/template_key = {@code "TEST"}) with a
 * masked recipient, so live tests are auditable, visible on the Logs screen on request, and
 * never counted as real traffic.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
@Slf4j
public class ProviderController {

    private static final String NOVU_CHANNEL_SMS = "sms";
    private static final String NOVU_CHANNEL_EMAIL = "email";
    private static final String WORKFLOW_SMS = "complaints-sms";
    private static final String WORKFLOW_EMAIL = "complaints-email";

    private final NovuClient novuClient;
    private final DeliveryProviderRegistry providers;
    private final DispatchLogRepository dispatchLogRepository;
    private final org.egov.novubridge.service.TwilioTemplateSyncService twilioTemplateSyncService;
    private final ProviderCatalog catalog;
    private final ChannelPolicyClient channelPolicy;
    private final ProviderAvailability providerAvailability;

    public ProviderController(NovuClient novuClient,
                              DeliveryProviderRegistry providers,
                              DispatchLogRepository dispatchLogRepository,
                              org.egov.novubridge.service.TwilioTemplateSyncService twilioTemplateSyncService,
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

    // ---- GET /providers/catalog -----------------------------------------

    /**
     * The out-of-the-box provider types and their credential forms. The configurator renders
     * the "Add provider" form straight from this, so a provider gained or a field renamed in
     * {@link ProviderCatalog} needs no SPA change. Contains no credentials — it is a
     * description of what to ASK for, never of what is stored.
     */
    @GetMapping("/providers/catalog")
    public ResponseEntity<Map<String, Object>> catalog() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", catalog.types());
        return ResponseEntity.ok(out);
    }

    // ---- GET /providers/twilio-templates ---------------------------------

    /**
     * §4 sync: pull the linked Twilio account's approved WhatsApp Content templates
     * and auto-match them to PGR routing keys. Returns {@code {matched:[…proposed
     * NotificationProviderTemplate rows…], unmatched:[…diagnostics…], total}} — the
     * configurator persists the matched rows to MDMS. Never returns credentials.
     */
    @GetMapping("/providers/twilio-templates")
    public ResponseEntity<Map<String, Object>> twilioTemplates() {
        return ResponseEntity.ok(twilioTemplateSyncService.syncWhatsappTemplates());
    }

    // ---- POST /providers -------------------------------------------------

    /**
     * Create a Novu provider integration from operator-entered credentials.
     * {@code WHATSAPP} maps to the Twilio {@code sms} Novu channel (WhatsApp is the
     * Twilio SMS integration used with a {@code whatsapp:} sender, not a separate
     * Novu channel). Returns the created integration via the ALLOWLIST projection —
     * never any {@code credentials}.
     */
    @PostMapping("/providers")
    public ResponseEntity<ProviderCreateResponse> createProvider(@RequestBody Map<String, Object> body) {
        // Catalog form: {type, name, credentials, active?}. Everything Novu needs beyond the
        // operator's credentials is resolved here, which is what makes these providers
        // configurable without an env edit or a redeploy.
        if (StringUtils.hasText(str(body.get("type")))) {
            return createFromCatalog(body);
        }
        // Legacy form: {channel, providerId, name, identifier, credentials}. Still the escape
        // hatch for a Novu provider the catalog does not cover; unchanged in every detail.
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));
        String name = str(body.get("name"));
        String identifier = str(body.get("identifier"));
        Map<String, Object> credentials = asMap(body.get("credentials"));

        if (!StringUtils.hasText(providerId)) {
            throw new CustomException("NB_INVALID_PROVIDER", "providerId is required");
        }
        String novuChannel = toNovuChannel(channel);

        // WHATSAPP is stored as a Novu `sms` integration, which destroys the
        // channel designation in every subsequent list/projection. Preserve it in
        // the integration identifier (the only round-trippable field — credentials
        // are never echoed back) so the UI can derive WHATSAPP for display.
        // Deterministic (stableId of the name), no clock/random.
        if ("WHATSAPP".equalsIgnoreCase(channel) && !StringUtils.hasText(identifier)) {
            identifier = "whatsapp-" + stableId(StringUtils.hasText(name) ? name : providerId);
        }

        NovuClient.NovuResponse novuResponse =
                novuClient.createIntegration(name, identifier, providerId, novuChannel, credentials);
        providerAvailability.invalidate();
        Map<String, Object> created = extractCreatedIntegration(novuResponse.getResponse());
        Map<String, Object> projected = IntegrationProjection.projectListItem(created);

        return new ResponseEntity<>(
                ProviderCreateResponse.builder().data(projected).build(), HttpStatus.OK);
    }

    /**
     * Create from a catalog {@code type}: the bridge resolves the Novu provider id, the Novu
     * channel, the credential mapping and a round-trippable identifier, so the operator only
     * ever fills in credentials.
     *
     * <p>The identifier is {@code <type>-<sha256(name)[0:16]>} — deterministic and prefixed, so
     * {@code GET /integrations} can say what each integration is and the dispatch path can tell
     * an Ozeki integration (which needs its own request body) from an SMSCountry one without
     * asking Novu. Required credentials are validated BEFORE anything reaches Novu: Novu
     * happily stores a half-filled integration and then fails every send.
     */
    private ResponseEntity<ProviderCreateResponse> createFromCatalog(Map<String, Object> body) {
        ProviderType type = catalog.require(str(body.get("type")));
        Map<String, Object> credentials = asMap(body.get("credentials"));
        catalog.validateRequired(type, credentials);

        String name = StringUtils.hasText(str(body.get("name"))) ? str(body.get("name")) : type.getLabel();
        String identifier = StringUtils.hasText(str(body.get("identifier")))
                ? str(body.get("identifier"))
                : ProviderCatalog.identifierFor(type.getType(), name);
        // Absent means yes: an operator adding a provider means to use it, and Novu's own
        // default (inactive) would make it invisible to every trigger.
        boolean active = !body.containsKey("active") || truthy(body.get("active"));

        NovuClient.NovuResponse novuResponse = novuClient.createIntegration(
                name, identifier, type.getNovuProviderId(), type.novuChannel(),
                catalog.toNovuCredentials(type, credentials), active);
        providerAvailability.invalidate();
        Map<String, Object> created = extractCreatedIntegration(novuResponse.getResponse());
        return new ResponseEntity<>(
                ProviderCreateResponse.builder().data(IntegrationProjection.projectListItem(created)).build(),
                HttpStatus.OK);
    }

    // ---- POST /providers/_update ----------------------------------------

    /**
     * Rename a provider, toggle it, or rotate its credentials. Id in the BODY, not the path:
     * the gateway's access control matches exact URLs, so every management call has to be a
     * POST to a fixed path.
     *
     * <p>{@code credentials} present means rotation. Novu REPLACES a credential set wholesale
     * on {@code PUT} rather than merging, so a partial credential map would silently blank the
     * keys it omits — hence the full required-field validation before the call, against the
     * type derived from the integration's own identifier. Nothing is echoed back but the
     * allowlist projection.
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
        // Novu answers 400 "No properties found for update" on an empty change set; say so here
        // instead, where the message can name the fields this endpoint accepts.
        if (!StringUtils.hasText(name) && novuCredentials == null && active == null) {
            throw new CustomException("NB_INVALID_PROVIDER",
                    "Nothing to update: supply at least one of name, credentials, active");
        }

        NovuClient.NovuResponse novuResponse =
                novuClient.updateIntegration(str(existing.get("_id")), name, novuCredentials, active);
        providerAvailability.invalidate();
        Map<String, Object> updated = extractCreatedIntegration(novuResponse.getResponse());
        if (updated.isEmpty()) {
            updated = existing;   // Novu answered without a body; project what we know.
        }
        return new ResponseEntity<>(
                ProviderCreateResponse.builder().data(IntegrationProjection.projectListItem(updated)).build(),
                HttpStatus.OK);
    }

    // ---- POST /providers/_delete ----------------------------------------

    /**
     * Delete a provider and the credentials Novu holds for it — but never one a tenant is
     * still routing through. Novu would delete it happily and every notification on that
     * channel would start failing with no active integration; the refusal is the whole point
     * of the endpoint.
     *
     * @return {@code {data:{id, deleted:true}}}, or HTTP 409 {@code NB_PROVIDER_IN_USE}
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

    /**
     * Resolve an integration by Novu {@code _id} OR by {@code identifier} — the configurator
     * holds whichever the list gave it. Novu v2.3.0 has no {@code GET /v1/integrations/{id}},
     * so this lists and filters. Throws {@code NB_PROVIDER_NOT_FOUND} rather than returning
     * null: every caller here treats "not found" the same way.
     */
    private Map<String, Object> findIntegration(String id) {
        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        for (Map<String, Object> i : IntegrationProjection.extractList(novuResponse.getResponse())) {
            if (id.equals(str(i.get("_id"))) || id.equals(str(i.get("identifier")))) {
                return i;
            }
        }
        throw new CustomException("NB_PROVIDER_NOT_FOUND", "No provider integration with id " + id);
    }

    // ---- GET /providers/templates ---------------------------------------

    /**
     * Read-only discovery of Novu workflows (delivery shells). Lists
     * {@code {workflowId, name, channels}} — does NOT call Twilio (Twilio has no
     * SMS template registry; SMS/EMAIL message text lives in MDMS
     * NotificationTemplate, approved WhatsApp ContentSids in
     * NotificationProviderTemplate). {@code channel} filters by the workflow's
     * Novu step types ({@code stepTypeOverviews}): SMS/WHATSAPP → {@code sms}
     * steps (WhatsApp rides the Twilio SMS integration), EMAIL → {@code email}.
     * {@code providerId} is accepted but not filterable — Novu workflows are
     * channel-scoped, not provider-scoped.
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
            // Skip-on-mismatch only when the workflow declares steps: a response
            // without stepTypeOverviews (older Novu) degrades to the unfiltered list.
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

    /** Lower-cased step types of a Novu v2 workflow ({@code stepTypeOverviews}). */
    @SuppressWarnings("unchecked")
    private static List<String> stepTypes(Map<String, Object> workflow) {
        Object raw = workflow.get("stepTypeOverviews");
        if (!(raw instanceof List)) {
            return List.of();
        }
        List<String> steps = new ArrayList<>();
        for (Object step : (List<Object>) raw) {
            if (step != null) {
                steps.add(String.valueOf(step).toLowerCase());
            }
        }
        return steps;
    }

    /**
     * Novu {@code GET /v2/workflows} nests the list at {@code data.workflows}
     * (unlike {@code /v1/integrations} whose list is {@code data} directly).
     * Tolerant of both plus a bare {@code workflows} key.
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> extractWorkflows(Map<String, Object> response) {
        if (response == null) {
            return List.of();
        }
        Object data = response.get("data");
        if (data instanceof Map && ((Map<String, Object>) data).get("workflows") instanceof List) {
            return (List<Map<String, Object>>) ((Map<String, Object>) data).get("workflows");
        }
        if (data instanceof List) {
            return (List<Map<String, Object>>) data;
        }
        if (response.get("workflows") instanceof List) {
            return (List<Map<String, Object>>) response.get("workflows");
        }
        return List.of();
    }

    // ---- POST /providers/verify -----------------------------------------

    /**
     * Verify connectivity of a configured integration by matching it in
     * {@code GET /v1/integrations} — by {@code integrationId} (matches Novu
     * {@code _id} or {@code identifier}), or by {@code channel}+{@code providerId}.
     * Returns {@code {ok, active, detail}}.
     */
    @PostMapping("/providers/verify")
    public ResponseEntity<Map<String, Object>> verify(@RequestBody Map<String, Object> body) {
        // `id` is the catalog-era alias of `integrationId`; `type` lets the UI verify "the
        // SMTP provider" without first knowing its id. Both are additive — a caller sending
        // only channel+providerId behaves exactly as before.
        String integrationId = firstText(str(body.get("integrationId")), str(body.get("id")));
        String type = str(body.get("type"));
        String channel = str(body.get("channel"));
        String providerId = str(body.get("providerId"));

        NovuClient.NovuResponse novuResponse = novuClient.listIntegrations();
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());

        String novuChannel = StringUtils.hasText(channel) ? toNovuChannel(channel) : null;
        Map<String, Object> match = null;
        for (Map<String, Object> i : integrations) {
            if (StringUtils.hasText(integrationId)) {
                if (integrationId.equals(str(i.get("_id"))) || integrationId.equals(str(i.get("identifier")))) {
                    match = i;
                    break;
                }
            } else if (StringUtils.hasText(type)) {
                if (catalog.require(type).getType().equals(ProviderCatalog.deriveType(i))) {
                    match = i;
                    break;
                }
            } else if (novuChannel != null && StringUtils.hasText(providerId)) {
                if (novuChannel.equalsIgnoreCase(str(i.get("channel")))
                        && providerId.equalsIgnoreCase(str(i.get("providerId")))) {
                    match = i;
                    break;
                }
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

    // ---- POST /providers/test-send --------------------------------------

    /**
     * Send a live test message through Novu. SMS/EMAIL trigger the per-channel
     * workflow with a {@code {body, subject}} payload. WHATSAPP rides the Twilio SMS
     * integration: {@code to.phone = "whatsapp:+<E164>"} plus the same
     * {@code overrides.providers.twilio} Content-template envelope the live dispatch path
     * uses ({@link NovuClient#buildProviderTemplateOverrides}) for an approved {@code contentSid}. The recipient-derived {@code subscriberId}
     * is stable (no clock/random) so a repeated test is reproducible. Writes one
     * {@code TEST}-tagged {@code nb_dispatch_log} row with a masked recipient.
     */
    @PostMapping("/providers/test-send")
    public ResponseEntity<Map<String, Object>> testSend(@RequestBody Map<String, Object> body) {
        String channel = str(body.get("channel"));
        Map<String, Object> to = asMap(body.get("to"));
        String phone = to != null ? str(to.get("phone")) : null;
        String email = to != null ? str(to.get("email")) : null;
        String workflowId = str(body.get("workflowId"));
        String bodyText = str(body.get("body"));
        String subject = str(body.get("subject"));
        String contentSid = str(body.get("contentSid"));
        List<Object> variables = asList(body.get("variables"));
        String txnInput = str(body.get("transactionId"));
        // The operator's tenant (the SPA sends it) so the row shows on THEIR Logs screen; the
        // synthetic "TEST" tenant is only the fallback for callers that omit it.
        String tenantId = StringUtils.hasText(str(body.get("tenantId"))) ? str(body.get("tenantId")) : "TEST";

        // Test ONE configured provider: `id` resolves to its Novu identifier so the trigger is
        // pinned to it, and to its catalog type so a gateway needing its own request body
        // (Ozeki) gets the same envelope the live path builds. `type` alone is enough to fill
        // in the channel, so the UI can offer "send a test" straight from a catalog card.
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

        // Stable, reproducible subscriberId — derived from the transactionId input
        // when supplied, else the recipient; NO clock/random so a re-test is idempotent.
        String seed = StringUtils.hasText(txnInput) ? txnInput
                : (recipient != null ? recipient : upperChannel);
        String subscriberId = "nb-test-" + stableId(seed);
        String transactionId = StringUtils.hasText(txnInput) ? txnInput : subscriberId;

        // The same provider seam the live pipeline uses: SMS may route to a direct gateway,
        // WhatsApp gets the identical Content-template envelope + integration override.
        String workflow = StringUtils.hasText(workflowId) ? workflowId
                : ("EMAIL".equals(upperChannel) ? WORKFLOW_EMAIL : WORKFLOW_SMS);
        Map<String, String> positional = toContentVariables(variables);
        Map<String, Object> contentVariables = positional == null ? null : new LinkedHashMap<>(positional);
        Dispatch dispatch = Dispatch.builder()
                .test(true)
                .channel(upperChannel)
                .subscriberId(subscriberId)
                .contact(Contact.builder().phone(phone).email(email).build())
                .body(bodyText)
                .subject(subject)
                .transactionId(transactionId)
                .templateId(contentSid)
                .contentVariables(contentVariables)
                .workflowOverride(workflow)
                .integrationIdentifier(integrationIdentifier)
                .providerType(providerType)
                .build();
        // An explicitly named integration is a Novu integration by construction (even the
        // SMSCountry one, which is generic-sms pointed at this service's adapter), so the
        // direct-gateway route must not swallow it. With no id named, selection is unchanged.
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

    // ---- helpers ---------------------------------------------------------

    /** SMS and WHATSAPP → Novu {@code sms}; EMAIL → {@code email}. */
    private static String toNovuChannel(String channel) {
        if (!StringUtils.hasText(channel)) {
            throw new CustomException("NB_INVALID_CHANNEL", "channel is required");
        }
        switch (channel.toUpperCase()) {
            case "SMS":
            case "WHATSAPP":
                return NOVU_CHANNEL_SMS;
            case "EMAIL":
                return NOVU_CHANNEL_EMAIL;
            default:
                throw new CustomException("NB_INVALID_CHANNEL", "Unsupported channel: " + channel);
        }
    }

    /** Novu create returns {@code {data:{...}}} (or bare object); unwrap defensively. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> extractCreatedIntegration(Map<String, Object> body) {
        if (body == null) {
            return new LinkedHashMap<>();
        }
        Object data = body.get("data");
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }
        return body;
    }

    /** Positional variables → Twilio 1-based contentVariables map ({@code {"1":..,"2":..}}). */
    private static Map<String, String> toContentVariables(List<Object> variables) {
        if (variables == null || variables.isEmpty()) {
            return null;
        }
        Map<String, String> cv = new LinkedHashMap<>();
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
        if (result != null && result.getRawResponse() != null) providerResponse.put("provider", result.getRawResponse());
        DispatchLogEntry entry = DispatchLogEntry.builder()
                .id(UUID.randomUUID())
                .eventId(UUID.randomUUID().toString())
                .transactionId(transactionId)
                .module("notifications")
                .eventName("TEST")
                .tenantId(tenantId)
                .isTest(true)
                .providerRef(result != null ? result.getProviderRef() : null)
                .channel(StringUtils.hasText(channel) ? channel : "UNKNOWN")
                .recipientValue(recipient != null ? PiiMask.mask(recipient) : "unknown")
                .templateKey("TEST")
                .status(ok ? "SENT" : "FAILED")
                .lastErrorCode(ok || result == null ? null : result.getProviderCode())
                .lastErrorMessage(ok || result == null ? null : result.getProviderMessage())
                .attemptCount(1)
                .providerResponse(providerResponse)
                .createdTime(now)
                .lastModifiedTime(now)
                .build();
        dispatchLogRepository.upsert(entry);
    }

    /** First 16 hex chars of SHA-256(seed) — deterministic, no clock/random. */
    private static String stableId(String seed) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(seed.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8 && i < digest.length; i++) {
                sb.append(String.format("%02x", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(seed.hashCode());
        }
    }

    private static String firstText(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) {
                return v;
            }
        }
        return null;
    }

    /** JSON booleans arrive as Boolean; forms sometimes send the string. Accept both. */
    private static boolean truthy(Object value) {
        return value instanceof Boolean ? (Boolean) value
                : Boolean.parseBoolean(String.valueOf(value).trim());
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }
}
