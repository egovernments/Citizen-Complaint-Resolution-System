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
 * Fetches the default mobile-number country-code prefix from the
 * {@code common-masters.UserValidation} master data schema.
 *
 * The resolved prefix is cached per tenantId to avoid repeated HTTP calls
 * during the lifecycle of the application.
 */
@Service
@Slf4j
public class MdmsServiceClient {

    /** Schema that carries the default country-code prefix. */
    private static final String SCHEMA_CODE = "common-masters.UserValidation";

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    /** Cache: tenantId → country-code prefix (e.g. "+91") */
    private final Map<String, String> prefixCache = new ConcurrentHashMap<>();

    public MdmsServiceClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Returns the default phone-number country-code prefix for the given tenant.
     *
     * <p>
     * The value is read from {@code data.attributes.prefix} of the first active
     * record in {@code common-masters.UserValidation} whose {@code default} flag is
     * {@code true}. The result is cached for the lifetime of the JVM.
     *
     * @param tenantId    eGov tenant identifier (e.g. {@code "etpmo"})
     * @param requestInfo the RequestInfo map from the incoming API request (used
     *                    as-is in the MDMS call)
     * @return prefix string like {@code "+91"}, never {@code null}
     */
    public MobileValidationConfig getMobileValidationConfig(
            String tenantId,
            RequestInfo requestInfo) {

        Map<String, Object> record = fetchDefaultRecord(tenantId, requestInfo);

        Map<String, Object> data =
                (Map<String, Object>) record.get("data");

        Map<String, Object> attributes =
                (Map<String, Object>) data.get("attributes");

        Map<String, Object> rules =
                (Map<String, Object>) data.get("rules");

        MobileValidationConfig config =
                new MobileValidationConfig();

        config.setPrefix((String) attributes.get("prefix"));
        config.setPattern((String) rules.get("pattern"));
        config.setMinLength((Integer) rules.get("minLength"));
        config.setMaxLength((Integer) rules.get("maxLength"));

        return config;
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
                throw new CustomException("NB_MDMS_PHONE_PREFIX_UNAVAILABLE",
                        "MDMS returned non-2xx or empty body while resolving phone prefix for tenantId=" + tenantId);
            }

            List<Map<String, Object>> mdmsList = (List<Map<String, Object>>) response.getBody().get("mdms");
            if (mdmsList == null || mdmsList.isEmpty()) {
                throw new CustomException("NB_MDMS_PHONE_PREFIX_UNAVAILABLE",
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
                            "NB_MDMS_PHONE_PREFIX_NOT_FOUND",
                            "No tenant-specific or default mobile validation config found in MDMS"
                    ));

            return record;

        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            throw new CustomException("NB_MDMS_PHONE_PREFIX_UNAVAILABLE",
                    "Failed to fetch phone prefix from MDMS for tenantId=" + tenantId + ": " + e.getMessage());
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
