package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.Values;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The out-of-the-box provider types: what the operator enters, which Novu provider backs each, and
 * how the credential form maps onto Novu's credential keys.
 *
 * <p>Every type is a Novu provider. SMSCountry, Ozeki and Jasmin are not in upstream Novu: they are
 * DIGIT's provider classes in {@code backend/novu-bridge/novu-worker-providers}, mounted into the
 * stock Novu {@code worker} and registered before it starts. A worker without them saves their
 * integrations fine and fails every send inside Novu, so a deployment that runs the worker without
 * them sets {@code novu.bridge.digit.worker.providers=false}: the catalog then leaves them out and
 * every attempt to create, rotate, re-enable or test one answers {@code NB_PROVIDER_TYPE_UNAVAILABLE}.
 *
 * <p>Novu's integration has no "catalog type" field and credentials are never read back, so the
 * type is encoded in the integration {@code identifier} as {@code <type>-<stableId(name)>}. That
 * lets credential rotation pick the right form from the identifier alone (Twilio SMS and Twilio
 * WhatsApp share one Novu provider id).
 */
@Component
public class ProviderCatalog {

    public static final String TWILIO_SMS = "twilio-sms";
    public static final String TWILIO_WHATSAPP = "twilio-whatsapp";
    public static final String SMTP = "smtp";
    public static final String SMSCOUNTRY = "smscountry";
    public static final String OZEKI = "ozeki";
    public static final String JASMIN = "jasmin";

    /** Novu provider ids. The last three are DIGIT's mounted worker providers (see the class doc). */
    public static final String NOVU_PROVIDER_TWILIO = "twilio";
    public static final String NOVU_PROVIDER_NODEMAILER = "nodemailer";
    public static final String NOVU_PROVIDER_SMSCOUNTRY = "smscountry";
    public static final String NOVU_PROVIDER_OZEKI = "ozeki";
    public static final String NOVU_PROVIDER_JASMIN = "jasmin";

    /** The Novu provider ids that exist only when the worker loads DIGIT's providers. */
    private static final Set<String> WORKER_NOVU_PROVIDERS =
            Set.of(NOVU_PROVIDER_SMSCOUNTRY, NOVU_PROVIDER_OZEKI, NOVU_PROVIDER_JASMIN);

    /** Longest-first so {@code twilio-whatsapp-…} never resolves to {@code twilio-sms}. */
    private static final List<String> TYPES_LONGEST_FIRST =
            List.of(TWILIO_WHATSAPP, SMSCOUNTRY, TWILIO_SMS, JASMIN, OZEKI, SMTP);

    /**
     * Unmarked integrations whose Novu provider id names exactly one type. {@code twilio} on the
     * {@code sms} channel is ambiguous in principle (WhatsApp rides it too) but pre-catalog
     * WhatsApp integrations carry the {@code whatsapp-} marker, so a bare one is SMS.
     */
    private static final Map<String, String> TYPE_BY_NOVU_SMS_PROVIDER = Map.of(
            NOVU_PROVIDER_TWILIO, TWILIO_SMS,
            NOVU_PROVIDER_SMSCOUNTRY, SMSCOUNTRY,
            NOVU_PROVIDER_OZEKI, OZEKI,
            NOVU_PROVIDER_JASMIN, JASMIN);

    private final NovuBridgeConfiguration config;

    public ProviderCatalog(NovuBridgeConfiguration config) {
        this.config = config;
    }

    /**
     * The catalog, in the order the configurator should offer it: without DIGIT's worker
     * providers when the worker does not load them.
     */
    public List<ProviderType> types() {
        List<ProviderType> types = allTypes();
        if (!config.isDigitWorkerProvidersEnabled()) {
            types.removeIf(t -> isWorkerProvider(t.getNovuProviderId()));
        }
        return types;
    }

    /** Is this Novu provider id one of DIGIT's worker providers (SMSCountry, Ozeki, Jasmin)? */
    public static boolean isWorkerProvider(String novuProviderId) {
        return novuProviderId != null && WORKER_NOVU_PROVIDERS.contains(novuProviderId.trim().toLowerCase(Locale.ROOT));
    }

    /** True when the provider id is a DIGIT worker provider and this deployment's worker lacks them. */
    public boolean isUnavailable(String novuProviderId) {
        return !config.isDigitWorkerProvidersEnabled() && isWorkerProvider(novuProviderId);
    }

    /** Throws {@code NB_PROVIDER_TYPE_UNAVAILABLE} for a DIGIT worker provider the worker does not load. */
    public void requireAvailable(String novuProviderId) {
        if (isUnavailable(novuProviderId)) {
            throw new CustomException("NB_PROVIDER_TYPE_UNAVAILABLE", unavailableMessage(novuProviderId.trim()));
        }
    }

    /** The one sentence every refusal (and a skipped dispatch) uses. */
    public static String unavailableMessage(String novuProviderId) {
        return "'" + novuProviderId + "' is one of DIGIT's providers in the Novu worker, and this deployment "
                + "runs the worker without them (NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false): Novu would accept "
                + "the message and fail it inside the worker. Choose another provider, or mount "
                + "novu-worker-providers into the worker and set the flag to true.";
    }

    private List<ProviderType> allTypes() {
        List<ProviderType> types = new ArrayList<>(6);
        types.add(ProviderType.builder()
                .type(TWILIO_SMS).label("Twilio SMS").channel("SMS").transport("novu")
                .novuProviderId(NOVU_PROVIDER_TWILIO)
                .credentialFields(List.of(
                        CredentialField.text("accountSid", "Account SID", true, "ACxxxxxxxx", null),
                        CredentialField.password("token", "Auth token", true, null),
                        CredentialField.text("from", "From number", true, "+14155238886",
                                "The Twilio number in E.164, SMS-enabled for the destination country")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(TWILIO_WHATSAPP).label("Twilio WhatsApp").channel("WHATSAPP").transport("novu")
                .novuProviderId(NOVU_PROVIDER_TWILIO)
                .credentialFields(List.of(
                        CredentialField.text("accountSid", "Account SID", true, "ACxxxxxxxx", null),
                        CredentialField.password("token", "Auth token", true, null),
                        CredentialField.text("from", "WhatsApp sender", true, "whatsapp:+14155238886",
                                "The WhatsApp-registered Twilio sender, prefixed whatsapp:")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(SMTP).label("Email (SMTP)").channel("EMAIL").transport("novu")
                .novuProviderId(NOVU_PROVIDER_NODEMAILER)
                .credentialFields(List.of(
                        CredentialField.text("host", "SMTP host", true, "smtp.example.org", null),
                        // Novu's nodemailer credential store is a string map; a numeric port is rejected.
                        CredentialField.text("port", "SMTP port", true, "587", "Sent as text, not a number"),
                        CredentialField.text("user", "Username", true, null, null),
                        CredentialField.password("password", "Password", true, null),
                        CredentialField.text("from", "From address", true, "no-reply@example.org", null),
                        // Novu's nodemailer config declares senderName required alongside from.
                        CredentialField.text("senderName", "From name", true, "City Grievance Desk", null),
                        CredentialField.checkbox("secure", "Use TLS on connect (port 465)",
                                "Leave off for STARTTLS on port 587")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(SMSCOUNTRY).label("SMSCountry").channel("SMS").transport("novu")
                .novuProviderId(NOVU_PROVIDER_SMSCOUNTRY)
                .credentialFields(List.of(
                        CredentialField.text("user", "Panel username", true, null, null),
                        CredentialField.password("password", "Panel password", true,
                                "The panel account type issues no API key"),
                        CredentialField.text("from", "Registered sender id", true, "KE-GOV",
                                "The sender id the messages are registered against"),
                        CredentialField.text("baseUrl", "Gateway URL", false, config.getSmsCountryUrl(),
                                "Leave blank to use the standard SMSCountry bulk endpoint. Legacy bulk API "
                                        + "only: success is a reply starting OK:, whatever the HTTP status")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(OZEKI).label("Ozeki SMS Gateway").channel("SMS").transport("novu")
                .novuProviderId(NOVU_PROVIDER_OZEKI)
                .credentialFields(List.of(
                        CredentialField.text("baseUrl", "HTTP API URL", true,
                                "http://ozeki.example.org:9509/api?action=sendmsg",
                                "The gateway's JSON send endpoint (HTTPS is usually port 9508)"),
                        CredentialField.text("user", "Username", true, null, "The gateway's HTTP API user"),
                        CredentialField.password("password", "Password", true, null),
                        CredentialField.text("from", "Sender id", false, null,
                                "Optional; the gateway's own default sender is used when blank")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(JASMIN).label("Jasmin SMS Gateway").channel("SMS").transport("novu")
                .novuProviderId(NOVU_PROVIDER_JASMIN)
                .credentialFields(List.of(
                        CredentialField.text("baseUrl", "Send URL", true, "http://jasmin.example.org:1401/send",
                                "Jasmin's HTTP API send endpoint. Text outside the GSM alphabet (Amharic, "
                                        + "emoji) is sent as UCS-2: 70 characters per SMS segment, not 160, "
                                        + "so the same message can cost two or three times as many segments"),
                        CredentialField.text("user", "Username", true, null, "The Jasmin HTTP API username"),
                        CredentialField.password("password", "Password", true, null),
                        CredentialField.text("from", "Sender id", false, null,
                                "Optional; the route's default source address is used when blank")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        return types;
    }

    /**
     * Look a type up, or throw {@code NB_UNKNOWN_PROVIDER_TYPE}; a DIGIT worker type the worker
     * does not load throws {@code NB_PROVIDER_TYPE_UNAVAILABLE}.
     */
    public ProviderType require(String type) {
        if (!StringUtils.hasText(type)) {
            throw new CustomException("NB_UNKNOWN_PROVIDER_TYPE", "type is required");
        }
        String wanted = type.trim().toLowerCase(Locale.ROOT);
        for (ProviderType t : allTypes()) {
            if (t.getType().equals(wanted)) {
                requireAvailable(t.getNovuProviderId());
                return t;
            }
        }
        throw new CustomException("NB_UNKNOWN_PROVIDER_TYPE", "Unknown provider type: " + type);
    }

    /** Deterministic, round-trippable identifier: {@code <type>-<sha256(name)[0:16]>}. */
    public static String identifierFor(String type, String name) {
        return type + "-" + Values.stableId(StringUtils.hasText(name) ? name : type);
    }

    /** The catalog type an identifier was minted for, or null (hand-created, pre-catalog). */
    public static String typeFromIdentifier(String identifier) {
        if (!StringUtils.hasText(identifier)) {
            return null;
        }
        String id = identifier.trim().toLowerCase(Locale.ROOT);
        for (String type : TYPES_LONGEST_FIRST) {
            if (id.equals(type) || id.startsWith(type + "-")) {
                return type;
            }
        }
        // Pre-catalog marker minted by the original POST /providers WhatsApp branch.
        if (id.startsWith("whatsapp-")) {
            return TWILIO_WHATSAPP;
        }
        return null;
    }

    /**
     * Identifier marker first, then the unambiguous providerId+channel pairs. Anything else (a
     * hand-made {@code generic-sms} integration, say) stays null: it has no catalog form.
     */
    public static String deriveType(Map<String, Object> integration) {
        if (integration == null) {
            return null;
        }
        String marked = typeFromIdentifier(Values.str(integration.get("identifier")));
        if (marked != null) {
            return marked;
        }
        String providerId = Values.lower(Values.str(integration.get("providerId")));
        String channel = Values.lower(Values.str(integration.get("channel")));
        if ("sms".equals(channel) && providerId != null && TYPE_BY_NOVU_SMS_PROVIDER.containsKey(providerId)) {
            return TYPE_BY_NOVU_SMS_PROVIDER.get(providerId);
        }
        if (NOVU_PROVIDER_NODEMAILER.equals(providerId) && "email".equals(channel)) {
            return SMTP;
        }
        return null;
    }

    /** The DIGIT channel each catalog type delivers; WhatsApp and SMS share Novu's {@code sms} channel. */
    private static final Map<String, String> CHANNEL_BY_TYPE = Map.of(
            TWILIO_SMS, "SMS", TWILIO_WHATSAPP, "WHATSAPP", SMTP, "EMAIL",
            SMSCOUNTRY, "SMS", OZEKI, "SMS", JASMIN, "SMS");

    /**
     * The DIGIT channel ({@code SMS}, {@code WHATSAPP}, {@code EMAIL}) an integration delivers, which
     * Novu's own channel cannot tell apart for SMS and WhatsApp: the catalog type first (identifier
     * marker, then providerId), else Novu's channel, where an unmarked {@code sms} integration (a
     * hand-made {@code generic-sms}, say) is SMS. Null for a channel DIGIT does not send on.
     */
    public static String digitChannelOf(Map<String, Object> integration) {
        String type = deriveType(integration);
        if (type != null) {
            return CHANNEL_BY_TYPE.get(type);
        }
        String channel = integration == null ? null : Values.lower(Values.str(integration.get("channel")));
        if ("email".equals(channel)) {
            return "EMAIL";
        }
        return "sms".equals(channel) ? "SMS" : null;
    }

    /** Novu stores a half-filled integration and then fails every send, so check first. Names keys only. */
    public void validateRequired(ProviderType type, Map<String, Object> credentials) {
        List<String> missing = new ArrayList<>();
        for (CredentialField field : type.getCredentialFields()) {
            if (!field.isRequired()) {
                continue;
            }
            Object value = credentials == null ? null : credentials.get(field.getKey());
            if (value == null || !StringUtils.hasText(value.toString().trim())) {
                missing.add(field.getKey());
            }
        }
        if (!missing.isEmpty()) {
            throw new CustomException("NB_INVALID_PROVIDER",
                    "Missing required credential(s) for " + type.getType() + ": " + String.join(", ", missing));
        }
    }

    /**
     * The operator's form as Novu's credential map. Every catalog field key is the Novu credential
     * key of its provider, so this copies exactly the declared keys: nothing unexpected reaches the
     * Novu credential store. Blank optional values are left out, so the provider's own default
     * applies (SMSCountry's standard endpoint, the gateway's default sender).
     */
    public Map<String, Object> toNovuCredentials(ProviderType type, Map<String, Object> credentials) {
        Map<String, Object> in = credentials == null ? Map.of() : credentials;
        Map<String, Object> out = new LinkedHashMap<>();
        for (CredentialField field : type.getCredentialFields()) {
            Object value = in.get(field.getKey());
            if (value == null) {
                continue;
            }
            if ("checkbox".equals(field.getType())) {
                out.put(field.getKey(), Boolean.valueOf(Values.truthy(value)));
            } else if (field.isRequired() || StringUtils.hasText(text(value))) {
                out.put(field.getKey(), "password".equals(field.getType()) ? value.toString() : text(value));
            }
        }
        return out;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }
}
