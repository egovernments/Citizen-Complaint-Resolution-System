package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.Values;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The out-of-the-box provider types: what the operator enters, which Novu provider backs each, and
 * how the credential form maps onto Novu's credential keys.
 *
 * <p>Novu's integration has no "catalog type" field and credentials are never read back, so the
 * type is encoded in the integration {@code identifier} as {@code <type>-<stableId(name)>}. That
 * lets the dispatch path tell an Ozeki integration (which needs its own request body) from the
 * identifier alone, with no extra Novu call.
 */
@Component
public class ProviderCatalog {

    public static final String TWILIO_SMS = "twilio-sms";
    public static final String TWILIO_WHATSAPP = "twilio-whatsapp";
    public static final String SMTP = "smtp";
    public static final String SMSCOUNTRY = "smscountry";
    public static final String OZEKI = "ozeki";

    /** Novu provider ids. Novu ships no "ozeki" or "smscountry" provider — both ride generic-sms. */
    public static final String NOVU_PROVIDER_TWILIO = "twilio";
    public static final String NOVU_PROVIDER_NODEMAILER = "nodemailer";
    public static final String NOVU_PROVIDER_GENERIC_SMS = "generic-sms";

    /** Stored as generic-sms {@code apiKeyRequestHeader}/{@code secretKeyRequestHeader}; Novu sends the credentials under these names. */
    public static final String SMSCOUNTRY_USER_HEADER = "X-SMSCountry-User";
    public static final String SMSCOUNTRY_PASSWORD_HEADER = "X-SMSCountry-Password";
    /** Same mechanism for Ozeki, except the gateway itself reads them, not this service. */
    public static final String OZEKI_USERNAME_HEADER = "X-Ozeki-Username";
    public static final String OZEKI_PASSWORD_HEADER = "X-Ozeki-Password";
    /**
     * The per-integration gateway URL, as a query parameter on the adapter URL: generic-sms has no
     * slot for a second URL and POSTs at {@code baseUrl} verbatim, so this is where it can ride.
     */
    public static final String ADAPTER_PARAM_API_URL = "apiUrl";

    /** Longest-first so {@code twilio-whatsapp-…} never resolves to {@code twilio-sms}. */
    private static final List<String> TYPES_LONGEST_FIRST =
            List.of(TWILIO_WHATSAPP, SMSCOUNTRY, TWILIO_SMS, OZEKI, SMTP);

    private final NovuBridgeConfiguration config;

    public ProviderCatalog(NovuBridgeConfiguration config) {
        this.config = config;
    }

    /** The catalog, in the order the configurator should offer it. */
    public List<ProviderType> types() {
        List<ProviderType> types = new ArrayList<>(5);
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
                .type(SMSCOUNTRY).label("SMSCountry").channel("SMS").transport("bridge-adapter")
                .novuProviderId(NOVU_PROVIDER_GENERIC_SMS)
                .credentialFields(List.of(
                        CredentialField.text("user", "Panel username", true, null, null),
                        CredentialField.password("password", "Panel password", true, null),
                        CredentialField.text("senderId", "Registered sender id", true, "KE-GOV",
                                "The sender id the messages are registered against"),
                        CredentialField.text("apiUrl", "Gateway URL", false, config.getSmsCountryUrl(),
                                "Leave blank to use the standard SMSCountry bulk endpoint")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        types.add(ProviderType.builder()
                .type(OZEKI).label("Ozeki SMS Gateway").channel("SMS").transport("novu-generic-sms")
                .novuProviderId(NOVU_PROVIDER_GENERIC_SMS)
                .credentialFields(List.of(
                        CredentialField.text("baseUrl", "HTTP API URL", true,
                                "https://ozeki.example.org:9509/api?action=sendmessage", null),
                        CredentialField.text("username", "Username", true, null, null),
                        CredentialField.password("password", "Password", true, null),
                        CredentialField.text("senderId", "Sender id", false, null,
                                "Optional; the gateway's own default sender is used when blank")))
                .supportsVerify(true).supportsTestSend(true)
                .build());
        return types;
    }

    /** Look a type up, or throw {@code NB_UNKNOWN_PROVIDER_TYPE}. */
    public ProviderType require(String type) {
        if (!StringUtils.hasText(type)) {
            throw new CustomException("NB_UNKNOWN_PROVIDER_TYPE", "type is required");
        }
        String wanted = type.trim().toLowerCase(Locale.ROOT);
        for (ProviderType t : types()) {
            if (t.getType().equals(wanted)) {
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
     * Identifier marker first, then the unambiguous providerId+channel pairs. Unmarked generic-sms
     * stays null: SMSCountry and Ozeki look identical and a guess would pick the wrong envelope.
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
        if (NOVU_PROVIDER_TWILIO.equals(providerId) && "sms".equals(channel)) {
            return TWILIO_SMS;
        }
        if (NOVU_PROVIDER_NODEMAILER.equals(providerId) && "email".equals(channel)) {
            return SMTP;
        }
        return null;
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
     * The operator's form as Novu's credential map. Twilio and SMTP are 1:1. Ozeki is generic-sms
     * at its own API. SMSCountry is generic-sms pointed at this service's adapter, the panel login
     * travelling as headers.
     */
    public Map<String, Object> toNovuCredentials(ProviderType type, Map<String, Object> credentials) {
        Map<String, Object> in = credentials == null ? Map.of() : credentials;
        switch (type.getType()) {
            case SMSCOUNTRY:
                return smsCountryCredentials(in);
            case OZEKI:
                return ozekiCredentials(in);
            default:
                // Only declared keys: nothing unexpected reaches the Novu credential store.
                Map<String, Object> out = new LinkedHashMap<>();
                for (CredentialField field : type.getCredentialFields()) {
                    Object value = in.get(field.getKey());
                    if (value != null) {
                        out.put(field.getKey(), "checkbox".equals(field.getType())
                                ? Boolean.valueOf(Values.truthy(value)) : value.toString());
                    }
                }
                return out;
        }
    }

    private Map<String, Object> smsCountryCredentials(Map<String, Object> in) {
        String apiUrl = text(in.get("apiUrl"));
        UriComponentsBuilder url = UriComponentsBuilder.fromUriString(config.getSmsCountryAdapterUrl());
        if (StringUtils.hasText(apiUrl)) {
            // The adapter refuses every send to such a URL; say so at save time instead.
            if (!config.isSmsCountryUrlAllowed(apiUrl)) {
                throw new CustomException("NB_ADAPTER_URL_NOT_ALLOWED", "Gateway URL must be an http(s) URL "
                        + "on an allowed host; add its host to novu.bridge.smscountry.allowed.hosts "
                        + "(NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS) or leave the field blank");
            }
            url.queryParam(ADAPTER_PARAM_API_URL, apiUrl);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("baseUrl", url.build().toUriString());
        out.put("apiKey", text(in.get("user")));
        out.put("apiKeyRequestHeader", SMSCOUNTRY_USER_HEADER);
        out.put("secretKey", text(in.get("password")));
        out.put("secretKeyRequestHeader", SMSCOUNTRY_PASSWORD_HEADER);
        // generic-sms puts `from` in the JSON body: that is how the sender id reaches the adapter.
        out.put("from", text(in.get("senderId")));
        // generic-sms reads idPath with a bare reduce and fails the step without it.
        out.put("idPath", "id");
        out.put("datePath", "date");
        return out;
    }

    private Map<String, Object> ozekiCredentials(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("baseUrl", text(in.get("baseUrl")));
        out.put("apiKey", text(in.get("username")));
        out.put("apiKeyRequestHeader", OZEKI_USERNAME_HEADER);
        out.put("secretKey", text(in.get("password")));
        out.put("secretKeyRequestHeader", OZEKI_PASSWORD_HEADER);
        out.put("from", text(in.get("senderId")));
        // Wrong paths only cost Novu's activity-feed correlation, not delivery.
        out.put("idPath", "data.0.message_id");
        out.put("datePath", "data.0.submit_date");
        return out;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }
}
