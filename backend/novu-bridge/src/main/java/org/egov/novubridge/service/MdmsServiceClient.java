package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.MobileValidationConfig;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Client for the eGov MDMS v2 service.
 *
 * Fetches the default mobile-number validation config from the
 * {@code common-masters.MobileNumberValidation} master data schema.
 *
 * The resolved config is cached per tenantId to avoid repeated HTTP calls
 * during the lifecycle of the application.
 */
@Service
@Slf4j
public class MdmsServiceClient {

    /** Schema that carries the mobile number validation config. */
    private static final String SCHEMA_CODE = "common-masters.MobileNumberValidation";

    /** Schema that carries per-tenant provider delivery config (WhatsApp sender number etc.). */
    private static final String PROVIDER_DETAIL_SCHEMA = "ProviderDetail";

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    /** Cache: tenantId → country-code prefix (e.g. "+91") */
    private final Map<String, String> prefixCache = new ConcurrentHashMap<>();

    /** Cache: tenantId → WhatsApp sender number from ProviderDetail MDMS */
    private final Map<String, String> senderCache = new ConcurrentHashMap<>();

    public MdmsServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Returns the mobile number validation config for the given tenant.
     *
     * <p>
     * The value is read from the first active record in
     * {@code common-masters.MobileNumberValidation} whose {@code default} flag is
     * {@code true}. The result is cached for the lifetime of the JVM.
     *
     * @param tenantId    eGov tenant identifier (e.g. {@code "etpmo"})
     * @param requestInfo the RequestInfo map from the incoming API request (used
     *                    as-is in the MDMS call)
     * @return {@link MobileValidationConfig} with countryCode and mobileNumberRegex, never {@code null}
     */
    public MobileValidationConfig getMobileValidationConfig(
            String tenantId,
            RequestInfo requestInfo) {

        Map<String, Object> record = fetchDefaultRecord(tenantId, requestInfo);

        Map<String, Object> data = (Map<String, Object>) record.get("data");

        MobileValidationConfig config = new MobileValidationConfig();
        config.setCountryCode((String) data.get("countryCode"));
        config.setMobileNumberRegex((String) data.get("mobileNumberRegex"));

        return config;
    }

    /**
     * Returns the WhatsApp sender number for the given tenant from the
     * {@code ProviderDetail} MDMS schema. Returns {@code null} if not configured;
     * the pipeline then falls back to the Novu integration's own credentials.from.
     */
    @SuppressWarnings("unchecked")
    public String getWhatsappSenderNumber(String tenantId) {
        if (senderCache.containsKey(tenantId)) {
            return senderCache.get(tenantId);
        }
        try {
            String url = config.getMdmsHost() + config.getMdmsSearchPath();

            Map<String, Object> mdmsCriteria = new HashMap<>();
            mdmsCriteria.put("tenantId", tenantId);
            mdmsCriteria.put("schemaCode", PROVIDER_DETAIL_SCHEMA);

            Map<String, Object> body = new HashMap<>();
            body.put("MdmsCriteria", mdmsCriteria);
            body.put("RequestInfo", buildMinimalRequestInfo());

            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(body),
                    (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                log.warn("MDMS returned non-2xx or empty body for ProviderDetail tenantId={}", tenantId);
                return null;
            }

            List<Map<String, Object>> mdmsList =
                    (List<Map<String, Object>>) response.getBody().get("mdms");
            if (mdmsList == null || mdmsList.isEmpty()) {
                log.warn("No ProviderDetail records in MDMS for tenantId={}", tenantId);
                return null;
            }

            String senderNumber = mdmsList.stream()
                    .map(r -> (Map<String, Object>) r.get("data"))
                    .filter(d -> d != null
                            && "whatsapp".equalsIgnoreCase((String) d.get("channel"))
                            && Boolean.TRUE.equals(d.get("isActive")))
                    .map(d -> (String) d.get("senderNumber"))
                    .filter(s -> s != null && !s.isBlank())
                    .findFirst().orElse(null);

            if (senderNumber != null) {
                senderCache.put(tenantId, senderNumber);
            }
            return senderNumber;
        } catch (Exception e) {
            log.warn("Failed to fetch WhatsApp senderNumber from MDMS for tenantId={}: {}",
                    tenantId, e.getMessage());
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // private helpers
    // -------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, Object>  fetchDefaultRecord(String tenantId,
                                       RequestInfo requestInfo) {
        try {
            String url = config.getMdmsHost() + config.getMdmsSearchPath();

            Map<String, Object> mdmsCriteria = new HashMap<>();
            mdmsCriteria.put("tenantId", tenantId);
            mdmsCriteria.put("schemaCode", SCHEMA_CODE);

            Map<String, Object> body = new HashMap<>();
            body.put("MdmsCriteria", mdmsCriteria);
            // Use the incoming RequestInfo as-is; fall back to a minimal one if absent
            body.put("RequestInfo", requestInfo != null ? requestInfo : buildMinimalRequestInfo());

            log.debug("Fetching country code from MDMS: url={}, tenantId={}, schemaCode={}", url, tenantId,
                    SCHEMA_CODE);

            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(body), (Class<Map<String, Object>>) (Class<?>) Map.class);

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new CustomException("MDMS_MOBILE_VALIDATION_UNAVAILABLE",
                        "MDMS returned non-2xx or empty body while resolving mobile validation config for tenantId=" + tenantId);
            }

            List<Map<String, Object>> mdmsList = (List<Map<String, Object>>) response.getBody().get("mdms");
            if (mdmsList == null || mdmsList.isEmpty()) {
                throw new CustomException("MDMS_MOBILE_VALIDATION_UNAVAILABLE",
                        "MDMS returned no records for schemaCode=" + SCHEMA_CODE + " tenantId=" + tenantId);
            }

            // Prefer the record flagged as default=true; fall back to the first record.
            Map<String, Object> record = mdmsList.stream()
                    .filter(r -> {
                        Map<String, Object> data = (Map<String, Object>) r.get("data");
                        return data != null && Boolean.TRUE.equals(data.get("default"));
                    })
                    .findFirst()
                    .orElseThrow(() -> new CustomException(
                            "MDMS_MOBILE_VALIDATION_NOT_FOUND",
                            "No default mobile validation config found in MDMS for tenantId=" + tenantId
                    ));

            return record;

        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            throw new CustomException("MDMS_MOBILE_VALIDATION_UNAVAILABLE",
                    "Failed to fetch mobile validation config from MDMS for tenantId=" + tenantId + ": " + e.getMessage());
        }
    }

    /**
     * Minimal RequestInfo used only when the Kafka consumer path has no auth token
     * available.
     */
    private Map<String, Object> buildMinimalRequestInfo() {
        Map<String, Object> ri = new HashMap<>();
        ri.put("apiId", "Rainmaker");
        ri.put("msgId", System.currentTimeMillis() + "|en_IN");
        ri.put("plainAccessRequest", new HashMap<>());
        return ri;
    }
}
