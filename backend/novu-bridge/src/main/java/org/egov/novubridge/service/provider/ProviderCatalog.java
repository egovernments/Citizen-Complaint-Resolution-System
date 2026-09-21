package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Single source of truth for the out-of-the-box notification providers: which types exist,
 * what the operator must type in for each, which Novu provider backs it, and how an
 * operator's credential form maps onto Novu's credential keys.
 *
 * <p>"Out of the box" means the operator only enters credentials in the configurator — no env
 * edits, no redeploy. Everything a type needs beyond those credentials (the Novu provider id,
 * the adapter URL, the response paths Novu parses) is filled in here.
 *
 * <p><b>Type round-trip.</b> Novu's integration object has no field for "which catalog type is
 * this" and credentials are never read back, so the type is encoded in the integration
 * {@code identifier} as a {@code <type>-<stableId(name)>} prefix — the same trick the
 * pre-catalog WhatsApp path used with its {@code whatsapp-} marker, which
 * {@link #typeFromIdentifier} still understands. That makes {@code GET /integrations} able to
 * say what each integration is, and lets the dispatch path know an identifier is an Ozeki one
 * (and therefore needs the passthrough envelope) without an extra Novu round trip.
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

    /**
     * Header names the SMSCountry adapter reads its per-call credentials from. They are
     * stored in the generic-sms integration as {@code apiKeyRequestHeader} /
     * {@code secretKeyRequestHeader}; Novu then sends the matching {@code apiKey} /
     * {@code secretKey} values under exactly these names.
     */
    public static final String SMSCOUNTRY_USER_HEADER = "X-SMSCountry-User";
    public static final String SMSCOUNTRY_PASSWORD_HEADER = "X-SMSCountry-Password";
    /** Same mechanism for Ozeki, except the gateway itself reads them, not this service. */
    public static final String OZEKI_USERNAME_HEADER = "X-Ozeki-Username";
    public static final String OZEKI_PASSWORD_HEADER = "X-Ozeki-Password";
    /**
     * Query parameter carrying the per-integration upstream gateway URL to the adapter.
     * generic-sms has no credential slot for "a second URL" ({@code domain} is the token-auth
     * URL and is only read when {@code authenticateByToken} is on), and it POSTs at
     * {@code baseUrl} verbatim with no path appended — so a query string on {@code baseUrl}
     * is the one place a non-secret per-integration setting can ride. The sender id does not
     * need this: it goes in the {@code from} credential, which generic-sms puts in the body.
     */
    public static final String ADAPTER_PARAM_API_URL = "apiUrl";

    /** Longest-first so {@code twilio-whatsapp-…} never resolves to {@code twilio-sms}. */
    private static final List<String> TYPES_LONGEST_FIRST =
            List.of(TWILIO_WHATSAPP, SMSCOUNTRY, TWILIO_SMS, OZEKI, SMTP);

    private final NovuBridgeConfiguration config;

    public ProviderCatalog(NovuBridgeConfiguration config) {
        this.config = config;
    }

    // ---- catalog ---------------------------------------------------------

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
                        // Novu's nodemailer credential store is a string map; a numeric port is
                        // rejected. The SPA sends and shows it as text.
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
                // The legacy bulk API has no credential-check call: the only way to learn whether
                // the login works is to send a message, so there is nothing honest to verify.
                .supportsVerify(false).supportsTestSend(true)
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
                .supportsVerify(false).supportsTestSend(true)
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

    // ---- identifier <-> type round trip -----------------------------------

    /** Deterministic, round-trippable identifier: {@code <type>-<sha256(name)[0:16]>}. */
    public static String identifierFor(String type, String name) {
        return type + "-" + stableId(StringUtils.hasText(name) ? name : type);
    }

    /**
     * The catalog type an integration identifier was minted for, or {@code null} when the
     * identifier carries no marker (hand-created integrations, pre-catalog deployments).
     */
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
     * Best-effort type for an existing integration: the identifier marker first, then the
     * unambiguous {@code providerId}+{@code channel} pairs. {@code generic-sms} without a
     * marker stays {@code null} — SMSCountry and Ozeki are indistinguishable from outside,
     * and guessing one would route the dispatch path through the wrong envelope.
     */
    public static String deriveType(Map<String, Object> integration) {
        if (integration == null) {
            return null;
        }
        String marked = typeFromIdentifier(asString(integration.get("identifier")));
        if (marked != null) {
            return marked;
        }
        String providerId = lower(asString(integration.get("providerId")));
        String channel = lower(asString(integration.get("channel")));
        if (NOVU_PROVIDER_TWILIO.equals(providerId) && "sms".equals(channel)) {
            return TWILIO_SMS;
        }
        if (NOVU_PROVIDER_NODEMAILER.equals(providerId) && "email".equals(channel)) {
            return SMTP;
        }
        return null;
    }

    // ---- credential mapping ----------------------------------------------

    /**
     * Reject a credential set missing a required field before anything is sent to Novu — a
     * half-configured integration is accepted by Novu and then fails every single send.
     * Only key NAMES are ever named in the error.
     */
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
     * Translate the operator's form into the credential map Novu stores. Twilio and SMTP are
     * 1:1 (the form keys ARE Novu's keys); the two generic-sms types are where the work is:
     *
     * <ul>
     *   <li><b>Ozeki</b> posts at its own JSON API, so {@code baseUrl} is the gateway and the
     *       username/password ride as headers.</li>
     *   <li><b>SMSCountry</b> cannot be a Novu provider at all — its legacy API is
     *       form-encoded with a plain-text reply. Novu is pointed at this service's adapter
     *       instead, with the panel login travelling as {@code apiKey}/{@code secretKey}
     *       under the header names the adapter reads. The two settings that are NOT secret
     *       (sender id, gateway URL) ride as query parameters on the adapter URL, so the
     *       adapter gets them whatever body shape Novu sends.</li>
     * </ul>
     */
    public Map<String, Object> toNovuCredentials(ProviderType type, Map<String, Object> credentials) {
        Map<String, Object> in = credentials == null ? Map.of() : credentials;
        switch (type.getType()) {
            case SMSCOUNTRY:
                return smsCountryCredentials(in);
            case OZEKI:
                return ozekiCredentials(in);
            default:
                // Twilio + nodemailer: copy only the keys the catalog declares, so an
                // operator cannot smuggle an unexpected key into the Novu credential store.
                Map<String, Object> out = new LinkedHashMap<>();
                for (CredentialField field : type.getCredentialFields()) {
                    Object value = in.get(field.getKey());
                    if (value != null) {
                        out.put(field.getKey(), "checkbox".equals(field.getType())
                                ? Boolean.valueOf(truthy(value)) : value.toString());
                    }
                }
                return out;
        }
    }

    private Map<String, Object> smsCountryCredentials(Map<String, Object> in) {
        String apiUrl = text(in.get("apiUrl"));
        UriComponentsBuilder url = UriComponentsBuilder.fromUriString(config.getSmsCountryAdapterUrl());
        if (StringUtils.hasText(apiUrl)) {
            url.queryParam(ADAPTER_PARAM_API_URL, apiUrl);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("baseUrl", url.build().toUriString());
        out.put("apiKey", text(in.get("user")));
        out.put("apiKeyRequestHeader", SMSCOUNTRY_USER_HEADER);
        out.put("secretKey", text(in.get("password")));
        out.put("secretKeyRequestHeader", SMSCOUNTRY_PASSWORD_HEADER);
        // generic-sms puts `from` (and a duplicate `sender`) in the JSON body, so the
        // registered sender id reaches the adapter without a second transport.
        out.put("from", text(in.get("senderId")));
        // The adapter answers {"id":"<jobid>","date":"<iso>"}. idPath is a required credential
        // and generic-sms reads it with a bare reduce — a body missing it throws inside the
        // provider and the step is recorded failed, so the adapter must always send both.
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
        // Ozeki's reply nests the accepted message under data[0]; Novu reads the correlation
        // id from here for its activity feed. Wrong paths only cost observability, not delivery.
        out.put("idPath", "data.0.message_id");
        out.put("datePath", "data.0.submit_date");
        return out;
    }

    // ---- helpers ---------------------------------------------------------

    /** First 16 hex chars of SHA-256(seed) — deterministic, no clock/random. */
    static String stableId(String seed) {
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

    private static boolean truthy(Object value) {
        return value instanceof Boolean ? (Boolean) value : Boolean.parseBoolean(String.valueOf(value).trim());
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private static String asString(Object value) {
        return value == null ? null : value.toString();
    }

    private static String lower(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }
}
