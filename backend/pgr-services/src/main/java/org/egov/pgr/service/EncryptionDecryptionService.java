package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.ComplaintTemplateTypeConfig;
import org.egov.pgr.web.models.ExtendedAttributes;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * Encrypt/decrypt/mask extendedAttributes fields via egov-enc-service.
 *
 * Which fields to encrypt is declared in the ComplaintSchema MDMS master's x-security array
 * (merged into ComplaintTemplateTypeConfig by MDMSUtils). This mirrors the x-security convention
 * from JSON Schema used by digit-config-service.
 *
 * Masking is all-or-nothing: when isConfidential=true and the caller lacks
 * CONFIDENTIAL_COMPLAINT_VIEWER, ALL dynamic fields are replaced with "****" and
 * decryption is skipped entirely.
 */
@Slf4j
@Service
public class EncryptionDecryptionService {

    private final RestTemplate restTemplate;
    private final PGRConfiguration config;
    private final ObjectMapper objectMapper;
    private final MultiStateInstanceUtil multiStateInstanceUtil;

    @Autowired
    public EncryptionDecryptionService(RestTemplate restTemplate,
                                       PGRConfiguration config,
                                       ObjectMapper objectMapper,
                                       MultiStateInstanceUtil multiStateInstanceUtil) {
        this.restTemplate = restTemplate;
        this.config = config;
        this.objectMapper = objectMapper;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
    }

    // Fields owned by User Service — never encrypted into JSONB here.
    private static final Set<String> USER_SERVICE_FIELDS = Set.of("email", "complainantAddress");

    /**
     * Encrypts fields listed in cfg.xSecurity. No encryptedFields list is stored —
     * the schema is the source of truth, read again at decrypt time.
     */
    public ExtendedAttributes encrypt(ExtendedAttributes ext, ComplaintTemplateTypeConfig cfg,
                                      String tenantId) {
        if (ext == null || cfg == null) return ext;

        List<String> secureFields = cfg.getXSecurity();
        if (secureFields == null || secureFields.isEmpty()) return ext;

        List<String> encKeys     = new ArrayList<>();
        List<String> plainValues = new ArrayList<>();

        for (String fieldKey : secureFields) {
            if (USER_SERVICE_FIELDS.contains(fieldKey)) continue; // User Service handles these
            Object raw = ext.getField(fieldKey);
            if (raw == null) continue;
            encKeys.add(fieldKey);
            plainValues.add(raw.toString());
        }

        if (plainValues.isEmpty()) return ext;

        List<String> ciphers = encryptWithFallback(plainValues, tenantId);
        for (int i = 0; i < encKeys.size(); i++)
            ext.putField(encKeys.get(i), i < ciphers.size() ? ciphers.get(i) : plainValues.get(i));

        return ext;
    }

    /**
     * Decrypts fields listed in cfg.xSecurity. Uses the schema as the source of truth
     * instead of a stored encryptedFields list. Skip when masking applies — use maskAll() instead.
     */
    public ExtendedAttributes decrypt(ExtendedAttributes ext, ComplaintTemplateTypeConfig cfg) {
        if (ext == null || cfg == null) return ext;

        List<String> secureFields = cfg.getXSecurity();
        if (secureFields == null || secureFields.isEmpty()) return ext;

        List<String> keys    = new ArrayList<>();
        List<String> ciphers = new ArrayList<>();

        for (String key : secureFields) {
            Object c = ext.getField(key);
            if (c == null) continue;
            keys.add(key);
            ciphers.add(c.toString());
        }

        if (ciphers.isEmpty()) return ext;

        try {
            List<String> plains = callDecryptBatch(ciphers);
            for (int i = 0; i < keys.size(); i++)
                ext.putField(keys.get(i), i < plains.size() ? plains.get(i) : "****");
        } catch (Exception e) {
            log.error("Batch decryption failed for fields {}; masking values", keys, e);
            keys.forEach(k -> ext.putField(k, "****"));
        }

        return ext;
    }

    /**
     * All-or-nothing masking: replaces every dynamic field with "****".
     * Call instead of decrypt() when the caller lacks CONFIDENTIAL_COMPLAINT_VIEWER.
     */
    public ExtendedAttributes maskAll(ExtendedAttributes ext) {
        if (ext == null || ext.getDynamicFields() == null || ext.getDynamicFields().isEmpty())
            return ext;
        new ArrayList<>(ext.getDynamicFields().keySet())
                .forEach(k -> ext.putField(k, "****"));
        return ext;
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private List<String> encryptWithFallback(List<String> plainValues, String tenantId) {
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        try {
            return callEncryptBatch(plainValues, tenantId);
        } catch (Exception cityEx) {
            log.warn("Encryption failed for tenant '{}', retrying with state tenant '{}'",
                    tenantId, stateTenant, cityEx);
        }
        try {
            return callEncryptBatch(plainValues, stateTenant);
        } catch (Exception stateEx) {
            // Refuse to store plaintext PII — a silent fallback would corrupt data on the next decrypt.
            throw new CustomException("ENCRYPTION_FAILED",
                    "egov-enc-service unavailable; rejecting to prevent plaintext PII storage: "
                            + stateEx.getMessage());
        }
    }

    private List<String> callEncryptBatch(List<String> values, String tenantId) {
        String url = config.getEncHost() + config.getEncEncryptEndpoint();
        List<Map<String, Object>> requests = new ArrayList<>();
        for (String v : values) {
            Map<String, Object> r = new HashMap<>();
            r.put("tenantId", tenantId);
            r.put("type", "Normal");
            r.put("value", v);
            requests.add(r);
        }
        Map<String, Object> payload = new HashMap<>();
        payload.put("encryptionRequests", requests);
        JsonNode response = restTemplate.postForObject(url, payload, JsonNode.class);
        return extractStringList(response);
    }

    private List<String> callDecryptBatch(List<String> ciphers) {
        String url = config.getEncHost() + config.getEncDecryptEndpoint();
        JsonNode response = restTemplate.postForObject(url, ciphers, JsonNode.class);
        return extractStringList(response);
    }

    private List<String> extractStringList(JsonNode node) {
        List<String> result = new ArrayList<>();
        if (node == null) return result;
        if (node.isArray()) node.forEach(n -> result.add(n.asText()));
        else result.add(node.asText());
        return result;
    }
}
