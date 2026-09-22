package org.egov.novubridge.service.resolution;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.repository.DispatchLogRows;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.TemplateRenderer.Rendered;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository.NotificationConfig;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.service.thin.ThinEventErrorCodes;
import org.egov.novubridge.service.thin.ThinEventHandler;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.springframework.util.StringUtils.hasText;

/**
 * The resolution stage: one thin event in, one v1 envelope per recipient x channel out, each
 * handed to {@link DispatchPipelineService} exactly as a producer would hand it one. The envelopes
 * stay in-process and are never published back to Kafka.
 *
 * <p>Order: catalogue (uncatalogued = REJECTED + DLQ), routing, then ALL audiences before anything
 * is sent (so the fan-out cap can refuse the whole event), then per recipient x channel: contact
 * gate, dedupe, render, WhatsApp provider template, mint, dispatch.
 *
 * <ul>
 *   <li>Dedupe is on {@code (channel, subscriberKey)}, not audience, so a person holding two
 *       notified roles gets one message; the key is consumed only after a successful hand-off.</li>
 *   <li>A configuration answer (no routing, no recipients, no template, unknown scheme, over the
 *       cap) is a SKIPPED row and never throws: replaying it would give the same answer.</li>
 *   <li>An infrastructure failure (directory lookup, render, dispatch) does not stop the other
 *       recipients, but the event then throws {@code NB_RESOLUTION_INCOMPLETE} so the consumer
 *       DLQs it. Transaction ids are stable, so a replay re-sends only what did not go.</li>
 * </ul>
 */
@Slf4j
public class NotificationResolver implements ThinEventHandler {

    private static final Set<String> VALID_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");

    /** The only provider whose templates the box resolves today. */
    private static final String WHATSAPP_PROVIDER = "twilio";

    private final NotificationConfigRepository config;
    private final Map<String, RecipientResolver> resolvers;
    private final LocaleProvider localeProvider;
    private final PlaceholderResolver placeholders;
    private final TemplateRenderer renderer;
    private final DispatchPipelineService pipeline;
    private final DispatchLogRepository ledger;
    private final String defaultLocale;
    private final int recipientCap;

    public NotificationResolver(NotificationConfigRepository config,
                                List<RecipientResolver> recipientResolvers,
                                LocaleProvider localeProvider,
                                PlaceholderResolver placeholders,
                                TemplateRenderer renderer,
                                DispatchPipelineService pipeline,
                                DispatchLogRepository ledger,
                                String defaultLocale,
                                int recipientCap) {
        this.config = config;
        this.localeProvider = localeProvider;
        this.placeholders = placeholders;
        this.renderer = renderer;
        this.pipeline = pipeline;
        this.ledger = ledger;
        this.defaultLocale = defaultLocale;
        this.recipientCap = recipientCap;
        Map<String, RecipientResolver> byScheme = new LinkedHashMap<>();
        for (RecipientResolver resolver : recipientResolvers) {
            byScheme.put(resolver.scheme().toUpperCase(Locale.ROOT), resolver);
        }
        this.resolvers = Collections.unmodifiableMap(byScheme);
    }

    @Override
    public void handle(ThinEvent event) {
        resolve(event, true);
    }

    /**
     * @param dispatch true on the Kafka path. False for the admin {@code _resolve} dry run: nothing
     *                 is sent, no row is written, and failures are reported in the outcome rather
     *                 than thrown.
     */
    public ResolutionOutcome resolve(ThinEvent event, boolean dispatch) {
        ResolutionOutcome outcome = new ResolutionOutcome();
        String tenantId = event.getTenantId();
        String seed = event.resolvedTransactionSeed();
        RequestInfo requestInfo = internalRequestInfo();

        // Loaded once so every master comes from the same namespace; a read failure throws (DLQ).
        NotificationConfig cfg = config.load(tenantId);
        requireCatalogued(event, cfg.catalogue(), dispatch);

        List<RoutingRow> matches = match(cfg.routing(), event.getEventName(), outcome);
        if (matches.isEmpty()) {
            return channelLess(event, outcome, dispatch, ThinEventErrorCodes.NO_ROUTING,
                    "No active NOTIFICATIONS.Routing row for eventName " + event.getEventName()
                            + " in tenant " + tenantId);
        }

        // ---- pass 1: who ----------------------------------------------------
        ResolutionContext context = new ResolutionContext(event, requestInfo);
        Map<String, List<Recipient>> byAudience = new LinkedHashMap<>();
        Set<String> unknownSchemes = new LinkedHashSet<>();
        List<Plan> plans = new ArrayList<>();
        int failedAudiences = 0;
        for (RoutingRow row : matches) {
            String audience = row.audience().trim();
            List<Recipient> recipients = byAudience.get(audience);
            if (recipients == null) {
                try {
                    recipients = resolveChain(audience, context, unknownSchemes);
                } catch (RecipientLimitExceededException e) {
                    return channelLess(event, outcome, dispatch, ThinEventErrorCodes.RECIPIENT_LIMIT_EXCEEDED,
                            e.getMessage() + "; nothing was delivered");
                } catch (Exception e) {
                    // Not memoized: the next routing row on this audience gets a fresh attempt.
                    failedAudiences++;
                    log.error("Failed to resolve audience {} for event {} in tenant {}",
                            audience, event.getEventId(), tenantId, e);
                    outcome.diagnose("audience " + audience + " could not be resolved: " + e.getMessage());
                    continue;
                }
                byAudience.put(audience, recipients);
            }
            if (!recipients.isEmpty()) {
                plans.add(new Plan(row, recipients));
            }
        }

        if (plans.isEmpty() && failedAudiences == 0) {
            String code = unknownSchemes.isEmpty()
                    ? ThinEventErrorCodes.NO_RECIPIENTS
                    : ThinEventErrorCodes.UNKNOWN_AUDIENCE_SCHEME;
            String message = unknownSchemes.isEmpty()
                    ? "Every audience on the matched routing rows resolved to nobody"
                    : "No resolver for audience scheme(s) " + unknownSchemes;
            return channelLess(event, outcome, dispatch, code, message);
        }

        int distinct = distinctRecipients(plans);
        if (distinct > recipientCap) {
            return channelLess(event, outcome, dispatch, ThinEventErrorCodes.RECIPIENT_LIMIT_EXCEEDED,
                    "Fan-out of " + distinct + " recipients exceeds the per-event cap of " + recipientCap
                            + "; nothing was delivered");
        }

        int failedMessages = plans.isEmpty() ? 0 : deliver(event, cfg, plans, requestInfo, dispatch, outcome);

        if (!unknownSchemes.isEmpty()) {
            // Its transaction id is <seed>:NONE, so it never collides with a dispatched row.
            channelLess(event, outcome, dispatch, ThinEventErrorCodes.UNKNOWN_AUDIENCE_SCHEME,
                    "No resolver for audience scheme(s) " + unknownSchemes
                            + "; the rest of the event was delivered");
        }
        return finish(event, outcome, dispatch, failedAudiences, failedMessages);
    }

    /** Pass 2: the messages. Returns how many recipient x channel messages failed. */
    private int deliver(ThinEvent event, NotificationConfig cfg, List<Plan> plans, RequestInfo requestInfo,
                        boolean dispatch, ResolutionOutcome outcome) {
        String tenantId = event.getTenantId();
        String seed = event.resolvedTransactionSeed();
        String localizationLocale = firstNonBlank(event.getLocalizationLocale(), defaultLocale);
        Map<String, String> values = placeholders.resolve(event, localizationLocale, requestInfo);
        Map<String, String> preferredLocales = preferredLocales(tenantId, requestInfo);
        List<TemplateRow> templates = cfg.templates();
        List<ProviderTemplateRow> providerTemplates = cfg.providerTemplates();

        int failed = 0;
        Set<String> emitted = new HashSet<>();
        for (Plan plan : plans) {
            String channel = plan.row().channel().trim().toUpperCase(Locale.ROOT);
            String audience = plan.row().audience().trim();
            // Per routing row: the same audience on three channels needs three renderings.
            Map<String, Rendered> renderedByLocale = new LinkedHashMap<>();
            Map<String, ProviderTemplateRow> providerByLocale = new LinkedHashMap<>();

            for (Recipient recipient : plan.recipients()) {
                if (recipient == null) {
                    continue;
                }
                String subscriberKey = recipient.subscriberKey();
                if (subscriberKey == null) {
                    log.warn("Dropping a {} recipient with neither uuid nor phone on event {}",
                            channel, event.getEventId());
                    outcome.diagnose("a " + audience + " recipient has no uuid and no phone; dropped");
                    continue;
                }
                String stage = "resolution";
                try {
                    if (!recipient.reachableOn(channel)) {
                        channelSkip(event, outcome, dispatch, seed, channel, subscriberKey, plan.row(),
                                "NB_CONTACT_MISSING", "Recipient has no "
                                        + ("EMAIL".equals(channel) ? "email address" : "phone number")
                                        + " for channel " + channel);
                        continue;
                    }
                    String dedupeKey = channel + "|" + subscriberKey;
                    if (emitted.contains(dedupeKey)) {
                        continue;
                    }
                    String locale = localeFor(preferredLocales, recipient);
                    if (!renderedByLocale.containsKey(locale)) {
                        renderedByLocale.put(locale, render(templates, event, audience, channel, locale, values));
                    }
                    Rendered rendered = renderedByLocale.get(locale);
                    if (rendered == null) {
                        channelSkip(event, outcome, dispatch, seed, channel, subscriberKey, plan.row(),
                                ThinEventErrorCodes.NO_TEMPLATE,
                                "No NOTIFICATIONS.Template for " + event.getEventName() + "." + audience
                                        + "." + channel + " in " + locale + " or " + defaultLocale);
                        continue;   // the dedupe key is NOT consumed
                    }
                    ProviderTemplateRow provider = null;
                    if ("WHATSAPP".equals(channel)) {
                        provider = providerByLocale.computeIfAbsent(locale, l -> providerTemplate(
                                providerTemplates, event.getEventName(), audience, l));
                    }
                    NotificationEvent envelope = mint(event, recipient, subscriberKey, locale, channel,
                            seed, rendered, provider, values);
                    outcome.getEnvelopes().add(envelope);
                    if (dispatch) {
                        stage = "dispatch";
                        outcome.getDispatches().add(pipeline.process(envelope, true, requestInfo,
                                DispatchLogEntry.SOURCE_PATH_RESOLVED));
                    }
                    emitted.add(dedupeKey);
                } catch (Exception e) {
                    failed++;
                    log.error("{} failed for {} to audience {} on event {}",
                            stage, channel, audience, event.getEventId(), e);
                    outcome.diagnose(stage + " failed for " + channel + " to " + PiiMask.mask(subscriberKey)
                            + ("dispatch".equals(stage) ? "" : " (before dispatch; no ledger row)")
                            + ": " + e.getMessage());
                }
            }
        }
        return failed;
    }

    /** Throws on the Kafka path when anything failed, after everything else was delivered. */
    private ResolutionOutcome finish(ThinEvent event, ResolutionOutcome outcome, boolean dispatch,
                                     int failedAudiences, int failedMessages) {
        if (failedAudiences == 0 && failedMessages == 0) {
            return outcome;
        }
        String message = failedAudiences + " audience lookup(s) and " + failedMessages
                + " recipient message(s) failed for event " + event.getEventId()
                + "; everything else was delivered";
        outcome.diagnose(ThinEventErrorCodes.RESOLUTION_INCOMPLETE + ": " + message);
        if (outcome.getTerminalCode() == null && outcome.getEnvelopes().isEmpty()) {
            outcome.setTerminalCode(ThinEventErrorCodes.RESOLUTION_INCOMPLETE);
        }
        if (dispatch) {
            throw new CustomException(ThinEventErrorCodes.RESOLUTION_INCOMPLETE, message);
        }
        return outcome;
    }

    // ---- catalogue ---------------------------------------------------------

    /**
     * An uncatalogued eventName is a producer fault: REJECTED + DLQ, so a replay after the row is
     * added succeeds. An EMPTY catalogue is exempt (an upgrade before the seeder's copy ran).
     */
    private void requireCatalogued(ThinEvent event, List<CatalogueRow> catalogue, boolean dispatch) {
        if (catalogue == null || catalogue.isEmpty()) {
            return;
        }
        for (CatalogueRow row : catalogue) {
            if (row.active() && event.getEventName().equalsIgnoreCase(row.eventName())) {
                return;
            }
        }
        String message = "eventName " + event.getEventName() + " has no active row in "
                + "NOTIFICATIONS.EventCatalogue for tenant " + event.getTenantId();
        if (dispatch) {
            writeChannelLess(event, "REJECTED", ThinEventErrorCodes.EVENT_NOT_IN_CATALOGUE, message);
        }
        throw new CustomException(ThinEventErrorCodes.EVENT_NOT_IN_CATALOGUE, message);
    }

    // ---- routing -----------------------------------------------------------

    /** Active rows for the event, in master order (= emission order); undeliverable rows dropped. */
    private List<RoutingRow> match(List<RoutingRow> rows, String eventName, ResolutionOutcome outcome) {
        List<RoutingRow> matched = new ArrayList<>();
        if (rows == null) {
            return matched;
        }
        for (RoutingRow row : rows) {
            if (!row.active() || !eventName.equalsIgnoreCase(row.eventName())) {
                continue;
            }
            if (!hasText(row.audience())) {
                log.warn("Ignoring a NOTIFICATIONS.Routing row with a blank audience for {}", eventName);
                continue;
            }
            if (AudienceRef.isEntirelyNonNotifiable(AudienceRef.parseChain(row.audience()))) {
                log.warn("Dropping non-notifiable routing row audience='{}' for {} (resolves to nobody)",
                        row.audience(), eventName);
                outcome.diagnose("routing row audience " + row.audience() + " is non-notifiable; dropped");
                continue;
            }
            String channel = row.channel() == null ? "" : row.channel().trim().toUpperCase(Locale.ROOT);
            if (!VALID_CHANNELS.contains(channel)) {
                log.warn("Ignoring a NOTIFICATIONS.Routing row with unknown channel '{}' for {} (must be {})",
                        row.channel(), eventName, VALID_CHANNELS);
                outcome.diagnose("routing row channel " + row.channel() + " is not deliverable; dropped");
                continue;
            }
            matched.add(row);
        }
        return matched;
    }

    // ---- recipients --------------------------------------------------------

    /** The chain's links in order; the first non-empty answer wins. */
    private List<Recipient> resolveChain(String audience, ResolutionContext ctx, Set<String> unknownSchemes) {
        for (AudienceRef ref : AudienceRef.parseChain(audience)) {
            if (AudienceRef.NON_NOTIFIABLE.equals(ref.scheme())) {
                continue;
            }
            RecipientResolver resolver = resolvers.get(ref.scheme());
            if (resolver == null) {
                unknownSchemes.add(ref.scheme());
                log.warn("No RecipientResolver for audience scheme '{}' (from '{}'); refusing to guess",
                        ref.scheme(), ref.raw());
                continue;
            }
            List<Recipient> found = resolver.resolve(ref, ctx);
            if (found != null && !found.isEmpty()) {
                return found;
            }
        }
        return Collections.emptyList();
    }

    private static int distinctRecipients(List<Plan> plans) {
        Set<String> keys = new HashSet<>();
        for (Plan plan : plans) {
            for (Recipient recipient : plan.recipients()) {
                String key = recipient == null ? null : recipient.subscriberKey();
                if (key != null) {
                    keys.add(key);
                }
            }
        }
        return keys.size();
    }

    private Map<String, String> preferredLocales(String tenantId, RequestInfo requestInfo) {
        if (localeProvider == null) {
            return Collections.emptyMap();
        }
        try {
            Map<String, String> locales = localeProvider.preferredLocales(tenantId, requestInfo);
            return locales == null ? Collections.emptyMap() : locales;
        } catch (Exception e) {
            log.warn("Preferred-language lookup unavailable for tenant {} ({}); rendering in {}",
                    tenantId, e.getMessage(), defaultLocale);
            return Collections.emptyMap();
        }
    }

    private String localeFor(Map<String, String> preferred, Recipient recipient) {
        if (hasText(recipient.locale())) {
            return recipient.locale().trim();
        }
        if (hasText(recipient.userId())) {
            String locale = preferred.get(recipient.userId().trim());
            if (hasText(locale)) {
                return locale.trim();
            }
        }
        return defaultLocale;
    }

    // ---- rendering ---------------------------------------------------------

    private Rendered render(List<TemplateRow> templates, ThinEvent event, String audience,
                            String channel, String locale, Map<String, String> values) {
        Rendered rendered = renderer.render(templates, event.getEventName(), audience, channel, locale, values);
        if (rendered == null || !"EMAIL".equals(channel) || hasText(rendered.subject())) {
            return rendered;
        }
        // Novu's email step rejects a blank subject and drops the whole send.
        return new Rendered(rendered.body(), "Complaint " + firstNonBlank(event.getEntityId(), event.getEventId()),
                rendered.templateKey());
    }

    /**
     * The approved provider template for the locale, else the default locale's, else null. Null
     * still mints the envelope, so the pipeline writes a visible NB_TEMPLATE_NOT_APPROVED row.
     */
    private ProviderTemplateRow providerTemplate(List<ProviderTemplateRow> rows, String eventName,
                                                 String audience, String locale) {
        ProviderTemplateRow exact = findProviderTemplate(rows, eventName, audience, locale);
        if (exact != null) {
            return exact;
        }
        if (defaultLocale != null && !defaultLocale.equalsIgnoreCase(locale)) {
            return findProviderTemplate(rows, eventName, audience, defaultLocale);
        }
        return null;
    }

    private static ProviderTemplateRow findProviderTemplate(List<ProviderTemplateRow> rows, String eventName,
                                                            String audience, String locale) {
        if (rows == null) {
            return null;
        }
        for (ProviderTemplateRow row : rows) {
            if (row.usable()
                    && WHATSAPP_PROVIDER.equalsIgnoreCase(row.provider())
                    && "WHATSAPP".equalsIgnoreCase(row.channel())
                    && eventName.equalsIgnoreCase(row.eventName())
                    && audience.equalsIgnoreCase(row.audience())
                    && locale.equalsIgnoreCase(row.locale())) {
                return row;
            }
        }
        return null;
    }

    /**
     * Twilio's positional {@code {"1":...}} from the template's ordered variables. A missing value
     * becomes "" (not null): existing behaviour, kept deliberately.
     */
    private static Map<String, Object> contentVariables(List<String> variables, Map<String, String> values) {
        if (variables == null || variables.isEmpty()) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < variables.size(); i++) {
            String name = variables.get(i);
            String value = name == null ? null : values.get(name);
            out.put(String.valueOf(i + 1), value == null ? "" : value);
        }
        return out;
    }

    // ---- minting -----------------------------------------------------------

    /**
     * One v1 envelope. {@code transactionId = <seed>:<tenantId>:<subscriberKey>:<channel>}: a
     * producer seed of {@code entityId:ACTION:TOSTATE} gives ids byte-identical to the pre-rendered
     * path, which is what stops a redeploy or a replay double-sending. {@code contact.locale} is
     * the recipient's preference; {@code templateKey} is what actually rendered. {@code templateId}
     * and {@code contentVariables} are absent, not null, without an approved provider template.
     */
    private NotificationEvent mint(ThinEvent event, Recipient recipient, String subscriberKey,
                                   String locale, String channel, String seed, Rendered rendered,
                                   ProviderTemplateRow provider, Map<String, String> values) {
        String subscriberId = event.getTenantId() + ":" + subscriberKey;
        NotificationEvent.NotificationEventBuilder envelope = NotificationEvent.builder()
                .schemaVersion("1")
                .eventId(UUID.randomUUID().toString())
                .eventType(event.getEventType())
                .eventName(event.resolvedLedgerEventName())
                .eventTime(Instant.now().toString())
                .producer(event.getProducer())
                .module(event.getModule())
                .entityType(event.getEntityType())
                .entityId(event.getEntityId())
                .tenantId(event.getTenantId())
                .channel(channel)
                .subscriberId(subscriberId)
                .contact(Contact.builder()
                        .userId(recipient.userId())
                        .type(recipient.type())
                        .name(recipient.name())
                        .phone(recipient.phone())
                        .email(recipient.email())
                        .locale(locale)
                        .build())
                .renderedBody(rendered.body())
                .subject(rendered.subject())
                .transactionId(String.join(":", seed, subscriberId, channel))
                .data(event.getPayload());
        if (hasText(rendered.templateKey())) {
            envelope.templateKey(rendered.templateKey());
        }
        if (provider != null) {
            envelope.templateId(provider.templateId());
            Map<String, Object> variables = contentVariables(provider.variables(), values);
            if (variables != null && !variables.isEmpty()) {
                envelope.contentVariables(variables);
            }
        }
        return envelope.build();
    }

    // ---- the ledger --------------------------------------------------------

    private ResolutionOutcome channelLess(ThinEvent event, ResolutionOutcome outcome, boolean dispatch,
                                          String code, String message) {
        log.info("Thin event {} ({}) in tenant {}: {} — {}", event.getEventId(), event.getEventName(),
                event.getTenantId(), code, message);
        if (outcome.getTerminalCode() == null) {
            outcome.setTerminalCode(code);
        }
        outcome.diagnose(code + ": " + message);
        if (dispatch) {
            writeChannelLess(event, "SKIPPED", code, message);
        }
        return outcome;
    }

    private void writeChannelLess(ThinEvent event, String status, String code, String message) {
        ledger.upsert(DispatchLogRows.channelLess(event.resolvedTransactionSeed())
                .eventId(event.getEventId())
                .referenceNumber(referenceNumber(event))
                .module(event.getModule())
                .eventName(event.resolvedLedgerEventName())
                .tenantId(event.getTenantId())
                .templateKey(event.getEventName())
                .status(status)
                .lastErrorCode(code)
                .lastErrorMessage(message)
                .build());
    }

    /**
     * A SKIPPED row on a known channel before there was a message. It carries the transaction id
     * the message WOULD have had, so a replay after the fix upserts this same row to SENT.
     */
    private void channelSkip(ThinEvent event, ResolutionOutcome outcome, boolean dispatch, String seed,
                             String channel, String subscriberKey, RoutingRow row, String code, String message) {
        String subscriberId = event.getTenantId() + ":" + subscriberKey;
        log.info("Thin event {}: {} for {} on {} — {}", event.getEventId(), code,
                PiiMask.mask(subscriberId), channel, message);
        outcome.diagnose(code + " (" + channel + ", " + PiiMask.mask(subscriberId) + "): " + message);
        if (!dispatch) {
            return;
        }
        long now = System.currentTimeMillis();
        ledger.upsert(DispatchLogEntry.builder()
                .eventId(event.getEventId())
                .transactionId(String.join(":", seed, subscriberId, channel))
                .referenceNumber(referenceNumber(event))
                .module(event.getModule())
                .eventName(event.resolvedLedgerEventName())
                .tenantId(event.getTenantId())
                .channel(channel)
                .recipientValue(subscriberId)
                .templateKey(event.getEventName() + "." + row.audience() + "." + channel)
                .status("SKIPPED")
                .attemptCount(1)
                .lastErrorCode(code)
                .lastErrorMessage(message)
                .sourcePath(DispatchLogEntry.SOURCE_PATH_RESOLVED)
                .isTest(false)
                .createdTime(now)
                .lastModifiedTime(now)
                .build());
    }

    private static String referenceNumber(ThinEvent event) {
        return hasText(event.getEntityId()) ? event.getEntityId().trim() : event.getEventId();
    }

    /** A thin event carries no RequestInfo, so the bridge stamps its own for DIGIT calls. */
    private static RequestInfo internalRequestInfo() {
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setApiId("novu-bridge");
        requestInfo.setVer("1.0");
        return requestInfo;
    }

    private static String firstNonBlank(String first, String second) {
        if (hasText(first)) {
            return first.trim();
        }
        return hasText(second) ? second.trim() : null;
    }

    private record Plan(RoutingRow row, List<Recipient> recipients) {
    }
}
