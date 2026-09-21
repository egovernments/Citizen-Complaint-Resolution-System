package org.egov.novubridge.service.resolution;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.repository.DispatchLogRows;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.service.thin.ThinEventErrorCodes;
import org.egov.novubridge.service.thin.ThinEventHandler;
import org.egov.novubridge.service.thin.ThinEventResult;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
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

/**
 * <b>The resolution stage.</b> One thin domain event in; N finished v1 envelopes out, each handed
 * to the dispatch pipeline exactly as a producer would hand it one.
 *
 * <pre>
 * ThinEvent ──► NotificationResolver ──► List&lt;NotificationEvent&gt; ──► DispatchPipelineService
 *               (routing, recipients,     (the published v1            (gates, transport,
 *                locale, rendering)        envelope, in memory)          ledger, receipts)
 * </pre>
 *
 * <p><b>The v1 envelope is the internal boundary between the two halves of the box</b>, and that
 * is the whole design. Everything already written about v1 — the schema, the gates, the
 * idempotency key, {@code outputs.md} — applies unchanged to the thin path, because the thin path
 * <i>produces</i> v1. There is no second set of delivery semantics to document, test or get
 * wrong. The envelopes are in-process objects and are never published back onto Kafka, which is
 * why a role notification to a forty-person pool now puts zero phone numbers on the broker.
 *
 * <h2>The order of decisions, and why each is where it is</h2>
 * <ol>
 *   <li><b>Catalogue.</b> An {@code eventName} with no active catalogue row is a producer fault:
 *       {@code REJECTED} + DLQ, because its placeholder vocabulary is unknown and letting it
 *       through would make the Configurator's validation a suggestion. A tenant with NO catalogue
 *       at all is exempt — that is a server upgraded before the seeder's copy ran, and refusing
 *       every event there would break the no-manual-migration constraint.</li>
 *   <li><b>Routing.</b> No active row for the event name is a configuration answer, not a
 *       failure: {@code SKIPPED / NB_NO_ROUTING} on a channel-less row. The single most likely
 *       reason an operator sees "nothing was sent" after onboarding an event.</li>
 *   <li><b>Recipients, for every matched audience, BEFORE anything is dispatched.</b> Two passes
 *       rather than one, for one reason: the fan-out cap must be able to refuse the whole event.
 *       Half a fan-out is worse than none, because nobody can tell which half went.</li>
 *   <li><b>Per recipient x channel:</b> the contact gate, then dedupe, then render, then the
 *       WhatsApp provider template, then mint and dispatch.</li>
 * </ol>
 *
 * <h2>Three semantics that are easy to lose and cost real incidents</h2>
 * <ul>
 *   <li><b>Dedupe is on {@code (channel, subscriberKey)} and the audience is deliberately NOT in
 *       the key</b>, so a person holding two notified roles gets one message per channel, not two.
 *       The key is consumed <b>only after a successful hand-off</b>: a missing template on the
 *       first routing row must not suppress the second row for the same person.</li>
 *   <li><b>A failed audience resolution does not poison the memo.</b> The memo exists so a role
 *       authored on SMS+WHATSAPP+EMAIL triggers one directory search rather than three; caching a
 *       failure would turn one blip into a silent three-channel outage.</li>
 *   <li><b>A configuration decision never throws.</b> No routing, no recipients, no template, an
 *       unknown audience scheme, a fan-out over the cap: each is an answer, each is a ledger row,
 *       none is a DLQ message — replaying them would produce the identical answer forever.</li>
 * </ul>
 */
@Slf4j
public class NotificationResolver implements ThinEventHandler {

    /** The channels the box can deliver on. A routing row naming anything else is dropped. */
    private static final Set<String> VALID_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");

    /** The only provider whose templates the box resolves today; see the provider catalog. */
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

    // ---- the seam ----------------------------------------------------------

    @Override
    public ThinEventResult handle(ThinEvent event) {
        ResolutionOutcome outcome = resolve(event, true);
        return ThinEventResult.builder()
                .dispatches(outcome.getDispatches())
                .terminalCode(outcome.getTerminalCode())
                .diagnostics(outcome.getDiagnostics())
                .build();
    }

    /**
     * Resolve one thin event.
     *
     * @param dispatch true on the Kafka path: every envelope goes through the dispatch pipeline
     *                 and every decision writes a ledger row. False for
     *                 {@code POST /dispatch/_resolve}: the envelopes are computed and returned and
     *                 <b>nothing is sent and no row is written</b>, which is what makes that
     *                 endpoint safe to point at a production tenant.
     */
    public ResolutionOutcome resolve(ThinEvent event, boolean dispatch) {
        ResolutionOutcome outcome = new ResolutionOutcome();
        String tenantId = event.getTenantId();
        String seed = event.resolvedTransactionSeed();
        RequestInfo requestInfo = internalRequestInfo();

        requireCatalogued(event, dispatch);

        List<RoutingRow> matches = match(config.routing(tenantId), event.getEventName(), outcome);
        if (matches.isEmpty()) {
            return channelLess(event, outcome, dispatch, ThinEventErrorCodes.NO_ROUTING,
                    "No active NOTIFICATIONS.Routing row for eventName " + event.getEventName()
                            + " in tenant " + tenantId);
        }

        // ---- pass 1: who ----------------------------------------------------
        ResolutionContext context = new ResolutionContext(tenantId, event, requestInfo);
        Map<String, List<Recipient>> byAudience = new LinkedHashMap<>();
        Set<String> unknownSchemes = new LinkedHashSet<>();
        List<Plan> plans = new ArrayList<>();
        for (RoutingRow row : matches) {
            String audience = row.audience().trim();
            List<Recipient> recipients = byAudience.get(audience);
            if (recipients == null) {
                try {
                    recipients = resolveChain(audience, context, unknownSchemes);
                } catch (Exception e) {
                    // Do NOT memoize a failure: the next routing row on the same audience gets a
                    // fresh attempt rather than inheriting one blip for the whole event.
                    log.error("Failed to resolve audience {} for event {} in tenant {}; skipping this row",
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

        if (plans.isEmpty()) {
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

        // ---- the words, once per event -------------------------------------
        String localizationLocale = firstNonBlank(event.getLocalizationLocale(), defaultLocale);
        Map<String, String> values = placeholders.resolve(event, localizationLocale, requestInfo);
        Map<String, String> preferredLocales = preferredLocales(tenantId, requestInfo);
        List<TemplateRow> templates = config.templates(tenantId);
        List<ProviderTemplateRow> providerTemplates = config.providerTemplates(tenantId);

        // ---- pass 2: the messages ------------------------------------------
        Set<String> emitted = new HashSet<>();
        for (Plan plan : plans) {
            String channel = plan.row.channel().trim().toUpperCase(Locale.ROOT);
            String audience = plan.row.audience().trim();
            // Memoized PER ROUTING ROW, not per event: the same audience on three channels needs
            // three renderings, and the same channel in two locales needs two.
            Map<String, Rendered> renderedByLocale = new LinkedHashMap<>();
            Map<String, ProviderTemplateRow> providerByLocale = new LinkedHashMap<>();

            for (Recipient recipient : plan.recipients) {
                if (recipient == null) {
                    continue;
                }
                String subscriberKey = recipient.subscriberKey();
                if (subscriberKey == null) {
                    // Neither a uuid nor a phone: no subscriber id, so no message and no row that
                    // could be addressed to them. Today's code drops this silently at publish
                    // time; inventing a key would make two different people share one ledger row.
                    log.warn("Dropping a {} recipient with neither uuid nor phone on event {}",
                            channel, event.getEventId());
                    outcome.diagnose("a " + audience + " recipient has no uuid and no phone; dropped");
                    continue;
                }
                if (!recipient.reachableOn(channel)) {
                    // Contact gate. A phone-only recipient on an EMAIL row would otherwise
                    // phantom-SEND: the pipeline would accept the envelope and the provider would
                    // reject it, or worse, silently succeed at nothing.
                    channelSkip(event, outcome, dispatch, seed, tenantId, channel, subscriberKey,
                            plan.row, null, "NB_CONTACT_MISSING",
                            "Recipient has no " + ("EMAIL".equals(channel) ? "email address" : "phone number")
                                    + " for channel " + channel);
                    continue;
                }
                String dedupeKey = channel + "|" + subscriberKey;
                if (emitted.contains(dedupeKey)) {
                    continue;
                }
                String locale = localeFor(preferredLocales, recipient);
                try {
                    Rendered rendered = renderedByLocale.get(locale);
                    if (rendered == null) {
                        rendered = render(templates, event, audience, channel, locale, values);
                        renderedByLocale.put(locale, rendered);
                    }
                    if (rendered.body == null) {
                        channelSkip(event, outcome, dispatch, seed, tenantId, channel, subscriberKey,
                                plan.row, null, ThinEventErrorCodes.NO_TEMPLATE,
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
                        outcome.getDispatches().add(
                                pipeline.process(envelope, true, requestInfo,
                                        DispatchLogEntry.SOURCE_PATH_RESOLVED));
                    }
                    emitted.add(dedupeKey);   // only a successful hand-off consumes the key
                } catch (Exception e) {
                    log.error("Failed to render or dispatch {} for audience {} on event {}",
                            channel, audience, event.getEventId(), e);
                    outcome.diagnose("failed to dispatch " + channel + " to "
                            + PiiMask.mask(subscriberKey) + ": " + e.getMessage());
                }
            }
        }

        if (!unknownSchemes.isEmpty()) {
            // Visible even though messages went out: the row's own transaction id is
            // <seed>:NONE, so it never collides with a dispatched row.
            channelLess(event, outcome, dispatch, ThinEventErrorCodes.UNKNOWN_AUDIENCE_SCHEME,
                    "No resolver for audience scheme(s) " + unknownSchemes
                            + "; the rest of the event was delivered");
        }
        return outcome;
    }

    // ---- catalogue ---------------------------------------------------------

    /**
     * An uncatalogued event name is a producer fault, so it is REJECTED and DLQ'd rather than
     * skipped — a replay after someone adds the catalogue row is exactly what should happen.
     *
     * <p>A tenant with an EMPTY catalogue is exempt, deliberately. That is a deployment upgraded
     * to this image before the seeder copied its config, and it is still serving legacy
     * {@code RAINMAKER-PGR.*} rows through the adapter. Refusing every event there would turn a
     * no-manual-migration upgrade into a notification outage.
     */
    private void requireCatalogued(ThinEvent event, boolean dispatch) {
        List<CatalogueRow> catalogue = config.catalogue(event.getTenantId());
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

    /**
     * The active routing rows for this event name, in master order — which is the order the
     * messages are emitted in, and an observable an operator can see on the Logs screen.
     *
     * <p>Rows are dropped, with a warning, for the same three reasons the old router dropped them:
     * a blank audience, an audience that is a deliberate nobody ({@code AUTO_ESCALATE},
     * {@code SYSTEM}), and a channel the box cannot deliver on.
     */
    private List<RoutingRow> match(List<RoutingRow> rows, String eventName, ResolutionOutcome outcome) {
        List<RoutingRow> matched = new ArrayList<>();
        if (rows == null) {
            return matched;
        }
        for (RoutingRow row : rows) {
            if (!row.active() || !eventName.equalsIgnoreCase(row.eventName())) {
                continue;
            }
            if (row.audience() == null || row.audience().trim().isEmpty()) {
                log.warn("Ignoring a NOTIFICATIONS.Routing row with a blank audience for {}", eventName);
                continue;
            }
            List<AudienceRef> chain = AudienceRef.parseChain(row.audience());
            if (AudienceRef.isEntirelyNonNotifiable(chain)) {
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

    /**
     * One audience column to its people: the links of the pipe chain in order, first non-empty
     * wins. {@code ACTOR:assignee|ROLE:PGR_LME} is exactly today's "notify the named assignee,
     * but fall through to the whole pool rather than notifying no one".
     */
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
            for (Recipient recipient : plan.recipients) {
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
        if (recipient.locale() != null && !recipient.locale().trim().isEmpty()) {
            return recipient.locale().trim();
        }
        String userId = recipient.userId();
        if (userId != null && !userId.trim().isEmpty()) {
            String locale = preferred.get(userId.trim());
            if (locale != null && !locale.trim().isEmpty()) {
                return locale.trim();
            }
        }
        return defaultLocale;
    }

    // ---- rendering ---------------------------------------------------------

    private Rendered render(List<TemplateRow> templates, ThinEvent event, String audience,
                            String channel, String locale, Map<String, String> values) {
        String body = renderer.render(templates, event.getEventName(), audience, channel, locale, values);
        if (body == null) {
            return new Rendered(null, null, null);
        }
        String templateKey = renderer.resolveTemplateKey(templates, event.getEventName(), audience,
                channel, locale);
        String subject = null;
        if ("EMAIL".equals(channel)) {
            subject = renderer.renderSubject(templates, event.getEventName(), audience, channel, locale, values);
            if (subject == null || subject.trim().isEmpty()) {
                // Novu's email step rejects a blank subject and drops the whole send.
                subject = "Complaint " + firstNonBlank(event.getEntityId(), event.getEventId());
            }
        }
        return new Rendered(body, subject, templateKey);
    }

    /**
     * The approved WhatsApp provider template for the recipient's locale, else the default
     * locale's, else null.
     *
     * <p>Null does NOT stop the send: the envelope is still minted, with no {@code templateId},
     * so the pipeline writes an auditable {@code SKIPPED / NB_TEMPLATE_NOT_APPROVED} row. Dropping
     * it here would make the skip invisible, which is how the WhatsApp gap used to look like
     * nothing happening at all.
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
            if (!row.usable()) {
                continue;
            }
            if (!WHATSAPP_PROVIDER.equalsIgnoreCase(row.provider())
                    || !"WHATSAPP".equalsIgnoreCase(row.channel())
                    || !eventName.equalsIgnoreCase(row.eventName())
                    || !audience.equalsIgnoreCase(row.audience())
                    || !locale.equalsIgnoreCase(row.locale())) {
                continue;
            }
            return row;
        }
        return null;
    }

    /**
     * Twilio's positional {@code contentVariables} ({@code {"1":…}}) from the provider template's
     * ORDERED {@code variables}, resolved against the event's placeholder values.
     *
     * <p>A missing placeholder becomes an EMPTY STRING, never null — which is today's behaviour
     * and is also the shape Twilio rejects with 21656 when every variable is empty. It is recorded
     * here rather than fixed here: changing it is a decision about what a half-populated WhatsApp
     * template should do, not a side effect of moving the code.
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
     * One finished v1 envelope. Every field here is part of a published contract and several are
     * pinned by the golden master:
     *
     * <ul>
     *   <li>{@code subscriberId = tenantId:subscriberKey} and
     *       {@code transactionId = <seed>:<subscriberId>:<channel>} — note the tenant id ends up
     *       INSIDE the transaction id, because the subscriber id is interpolated whole. A producer
     *       that sets {@code transactionSeed = entityId:ACTION:TOSTATE} therefore gets byte-identical
     *       ids to the pre-rendered path, which is what stops a mid-flight redeploy double-sending
     *       and what keeps the e2e harness's six-segment parse working.</li>
     *   <li>{@code contact.locale} is the recipient's PREFERENCE, not the locale that rendered.
     *       {@code templateKey} is the only field that reports what was actually rendered, and the
     *       two differ exactly when someone prefers a language the templates do not have.</li>
     *   <li>{@code templateId} and {@code contentVariables} are ABSENT from the envelope, not
     *       present-and-null, when there is no approved provider template.</li>
     * </ul>
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
                .renderedBody(rendered.body)
                .subject(rendered.subject)
                .transactionId(String.join(":", seed, subscriberId, channel))
                .data(event.getPayload());
        if (rendered.templateKey != null && !rendered.templateKey.trim().isEmpty()) {
            envelope.templateKey(rendered.templateKey);
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
     * A {@code SKIPPED} row for a decision the box took once it KNEW the channel but before there
     * was a message: no template for this key, or a recipient who cannot be reached on it.
     *
     * <p>It carries the transaction id the message WOULD have had, so when the missing template is
     * authored and the event is replayed, the send upserts this very row and the operator watches
     * the same line go from skipped to sent instead of finding two.
     */
    private void channelSkip(ThinEvent event, ResolutionOutcome outcome, boolean dispatch, String seed,
                             String tenantId, String channel, String subscriberKey, RoutingRow row,
                             String templateKey, String code, String message) {
        String subscriberId = tenantId + ":" + subscriberKey;
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
                .tenantId(tenantId)
                .channel(channel)
                .recipientValue(subscriberId)
                .templateKey(templateKey != null ? templateKey
                        : event.getEventName() + "." + row.audience() + "." + channel)
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
        String entityId = event.getEntityId();
        return entityId != null && !entityId.trim().isEmpty() ? entityId.trim() : event.getEventId();
    }

    /**
     * The context the box calls DIGIT with. A thin event carries no {@code RequestInfo} — it is a
     * Kafka message from a service, not a user request — so the bridge stamps its own, exactly as
     * {@code ChannelPolicyClient} already does for MDMS.
     */
    private static RequestInfo internalRequestInfo() {
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setApiId("novu-bridge");
        requestInfo.setVer("1.0");
        return requestInfo;
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }

    /** One rendered (body, subject, templateKey) for one locale. A null body means no template. */
    private static final class Rendered {
        final String body;
        final String subject;
        final String templateKey;

        Rendered(String body, String subject, String templateKey) {
            this.body = body;
            this.subject = subject;
            this.templateKey = templateKey;
        }
    }

    /** One routing row and the people it resolved to, computed before anything is dispatched. */
    private static final class Plan {
        final RoutingRow row;
        final List<Recipient> recipients;

        Plan(RoutingRow row, List<Recipient> recipients) {
            this.row = row;
            this.recipients = recipients;
        }
    }
}
