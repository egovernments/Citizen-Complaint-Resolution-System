package org.egov.handler.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.web.models.MdmsCriteriaReqV2;
import org.egov.handler.web.models.MdmsCriteriaV2;
import org.egov.handler.web.models.MdmsResponseV2;
import org.egov.tracer.model.CustomException;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class MdmsBulkLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;
    private final MdmsV2Util mdmsV2Util;


    public void loadAllMdmsData(String tenantId, RequestInfo requestInfo, String mdmsDataPath) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

            // Match all files inside the specified path
            Resource[] resources = resolver.getResources(mdmsDataPath);

            // Sort alphabetically by full URI path so that reference dependencies are respected.
            // Directory names ensure correct order:
            //   ACCESSCONTROL-ACTIONS-TEST  (actions)
            //   ACCESSCONTROL-ROLE          (roles)
            //   ACCESSCONTROL-ROLEACTIONS   (x-ref-validates both of the above)
            Arrays.sort(resources, Comparator.comparing(r -> {
                try { return r.getURI().toString(); } catch (Exception e) { return ""; }
            }));

            for (Resource resource : resources) {
                String fileName = resource.getFilename();
                if (fileName == null || !fileName.endsWith(".json")) continue;

                String schemaCode = fileName.replace(".json", "");

                // Idempotency guard: skip seeding this schemaCode's bundled data if the
                // target tenant already has rows for it. Seed bundles are fixed/all-or-
                // nothing, so any existing row means it was already seeded (e.g. by the
                // db_fast_path DB dump, or a previous deploy/converge). Without this,
                // re-seeding duplicates records — and for DataSecurity.SecurityPolicy a
                // duplicate crashes egov-user's encryption client (Collectors.toMap →
                // "Duplicate key"), failing compose-up. mdms-v2 does not reject these as
                // duplicates because the dump-inserted rows bypass its uniqueness check.
                // Fail-open: if the pre-check errors, fall through and seed as before.
                try {
                    MdmsCriteriaV2 existsCriteria = MdmsCriteriaV2.builder()
                            .tenantId(tenantId).schemaCode(schemaCode).offset(0).limit(1).build();
                    MdmsCriteriaReqV2 existsReq = MdmsCriteriaReqV2.builder()
                            .requestInfo(requestInfo).mdmsCriteria(existsCriteria).build();
                    MdmsResponseV2 existing = mdmsV2Util.searchMdmsData(existsReq);
                    if (existing != null && existing.getMdms() != null && !existing.getMdms().isEmpty()) {
                        log.info("MDMS data already present for schemaCode {} in tenant {} — skipping seed (idempotent)",
                                schemaCode, tenantId);
                        continue;
                    }
                } catch (Exception preCheckEx) {
                    log.warn("Idempotency pre-check failed for schemaCode {} in tenant {}; proceeding with seed: {}",
                            schemaCode, tenantId, preCheckEx.getMessage());
                }

                // Read JSON content
                String rawJson = StreamUtils.copyToString(resource.getInputStream(), StandardCharsets.UTF_8);
                JsonNode arrayNode = objectMapper.readTree(rawJson);

                if (!arrayNode.isArray()) {
                    log.error("File must contain a JSON array: {}", fileName);
                    continue; // skip this file
                }

                for (JsonNode singleObjectNode : arrayNode) {
                    try {
                        // Convert node to raw string
                        String singleObjectJson = objectMapper.writeValueAsString(singleObjectNode);

                        // Replace all {tenantid} placeholders with actual tenant ID
                        singleObjectJson = singleObjectJson.replace("{tenantid}", tenantId);

                        // Convert back to object
                        Object singleDataObject = objectMapper.readValue(singleObjectJson, Object.class);

                        // Construct MDMS wrapper
                        Map<String, Object> mdms = new HashMap<>();
                        mdms.put("tenantId", tenantId);
                        mdms.put("schemaCode", schemaCode);
                        mdms.put("data", singleDataObject);
                        mdms.put("isActive", true);

                        Map<String, Object> requestPayload = new HashMap<>();
                        requestPayload.put("Mdms", mdms);
                        requestPayload.put("RequestInfo", requestInfo);

                        String endpoint = serviceConfig.getMdmsDataCreateURI().replace("{schemaCode}", schemaCode);
                        restTemplate.postForObject(endpoint, requestPayload, Object.class);

                        log.info("Created MDMS entry for schemaCode: {} from file: {}", schemaCode, fileName);
                    } catch (Exception innerEx) {
                        log.error("Failed to create MDMS entry for schemaCode: {} in file: {}. Skipping...",
                                schemaCode, fileName, innerEx);
                        // Continue with next record
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to load MDMS files: {}", e.getMessage(), e);
//        throw new CustomException("MDMS_BULK_LOAD_FAILED", "Failed to load all MDMS data: " + e.getMessage());
        }
    }

}
