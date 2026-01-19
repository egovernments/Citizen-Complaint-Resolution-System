package org.egov.handler.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.web.models.BusinessServiceRequest;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.io.InputStream;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class WorkflowConfigLoader {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final ServiceConfiguration serviceConfig;

    /**
     * Load workflow configurations from the given path pattern
     * @param tenantId The tenant ID to apply configurations for
     * @param workflowPath The classpath pattern to load workflow configs from
     */
    public void loadWorkflowConfigFromPath(String tenantId, String workflowPath) {
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            Resource[] resources = resolver.getResources(workflowPath);

            if (resources.length == 0) {
                log.debug("No workflow config files found at path: {}", workflowPath);
                return;
            }

            log.info("Found {} workflow config files at path: {}", resources.length, workflowPath);

            for (Resource resource : resources) {
                String fileName = resource.getFilename();
                if (fileName == null || !fileName.endsWith(".json")) continue;

                // Skip non-workflow config files (like PgrIndexer.json)
                if (!fileName.toLowerCase().contains("workflow") && !fileName.toLowerCase().contains("config")) {
                    log.debug("Skipping non-workflow file: {}", fileName);
                    continue;
                }

                try (InputStream inputStream = resource.getInputStream()) {
                    BusinessServiceRequest businessServiceRequest = objectMapper.readValue(
                            inputStream, BusinessServiceRequest.class);

                    if (businessServiceRequest.getBusinessServices() != null) {
                        businessServiceRequest.getBusinessServices()
                                .forEach(service -> service.setTenantId(tenantId));

                        String uri = serviceConfig.getWfBusinessServiceCreateURI();
                        restTemplate.postForObject(uri, businessServiceRequest, Map.class);

                        log.info("Workflow config loaded successfully from file: {} for tenant: {}",
                                fileName, tenantId);
                    }
                } catch (Exception e) {
                    log.error("Failed to load workflow config from file: {}. Skipping...", fileName, e);
                }
            }
        } catch (Exception e) {
            log.error("Failed to load workflow configs from path: {}", workflowPath, e);
        }
    }
}
