package org.egov.handler.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.web.models.*;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Slf4j
@Component
public class LocalizationUtil {

	private final RestTemplate restTemplate;

	private final ServiceConfiguration serviceConfig;

	private final ResourceLoader resourceLoader;

	@Autowired
	public LocalizationUtil(RestTemplate restTemplate, ServiceConfiguration serviceConfig, ResourceLoader resourceLoader) {
		this.restTemplate = restTemplate;
		this.serviceConfig = serviceConfig;
        this.resourceLoader = resourceLoader;
    }

	public void createLocalizationData(DefaultLocalizationDataRequest defaultLocalizationDataRequest) {

		StringBuilder uri = new StringBuilder();
		uri.append(serviceConfig.getLocalizationDefaultDataCreateURI());
		try {
			restTemplate.postForObject(uri.toString(), defaultLocalizationDataRequest, ResponseInfo.class);
		} catch (Exception e) {
			log.error("Error creating default localization data for {} : {}", defaultLocalizationDataRequest.getTargetTenantId(), e.getMessage());
			throw new CustomException("LOCALIZATION_DEFAULT_DATA_CREATE_FAILED", "Failed to create localization data for " + defaultLocalizationDataRequest.getTargetTenantId() + " : " + e.getMessage());
		}
	}

	public void upsertLocalizationFromFile(DefaultDataRequest defaultDataRequest){

		List<Message> messageList = addMessagesFromFile(defaultDataRequest);
		defaultDataRequest.getRequestInfo().getUserInfo().setId(128L);

		String tenantId = defaultDataRequest.getTargetTenantId();
		RequestInfo requestInfo = defaultDataRequest.getRequestInfo();
		String uri = serviceConfig.getUpsertLocalizationURI();

		int batchSize = 100;
		int totalMessages = messageList.size();

		try {
			for (int i = 0; i < totalMessages; i += batchSize) {
				int end = Math.min(i + batchSize, totalMessages);
				List<Message> batch = messageList.subList(i, end);

				CreateMessagesRequest createMessagesRequest = CreateMessagesRequest.builder()
						.requestInfo(requestInfo)
						.tenantId(tenantId)
						.messages(batch)
						.build();
				try {
					restTemplate.postForObject(uri, createMessagesRequest, ResponseInfo.class);
					log.info("Localization batch [{}-{}] upserted successfully for tenant: {}", i + 1, end, tenantId);
				} catch (Exception e) {
					log.error("Failed to upsert localization batch [{}-{}] for tenant: {}. Skipping... Reason: {}",
							i + 1, end, tenantId, e.getMessage());
					// Continue with next batch
				}
			}
			log.info("Localization data upserted successfully for tenant: {}", tenantId);
		} catch (Exception e) {
			log.error("Error creating Tenant localization data for {} : {}", tenantId, e.getMessage());
//			throw new CustomException("TENANT", "Failed to create localization data for " + tenantId + " : " + e.getMessage());
		}
	}

	public List addMessagesFromFile(DefaultDataRequest defaultDataRequest){
		List<Message> messages = new ArrayList<>();
		ObjectMapper objectMapper = new ObjectMapper();

		// Load common localizations first (always loaded)
		messages.addAll(loadCommonLocalizations(objectMapper));

		// Load module-specific localizations for enabled modules
		List<String> enabledModules = serviceConfig.getEnabledModules();
		if (enabledModules != null && !enabledModules.isEmpty()) {
			for (String module : enabledModules) {
				messages.addAll(loadModuleLocalizations(objectMapper, module.trim()));
			}
		}

		return messages;
	}

	/**
	 * Load localizations for a specific module from localisations/modules/{MODULE}/ folder
	 */
	private List<Message> loadModuleLocalizations(ObjectMapper objectMapper, String moduleName) {
		List<Message> messages = new ArrayList<>();

		try {
			PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
			String pattern = "classpath:localisations/modules/" + moduleName + "/**/*.json";

			Resource[] resources = resolver.getResources(pattern);

			if (resources.length == 0) {
				log.warn("No localization files found for module: {} at path: {}", moduleName, pattern);
				return messages;
			}

			log.info("Found {} localization files for module: {}", resources.length, moduleName);

			for (Resource resource : resources) {
				try (InputStream inputStream = resource.getInputStream()) {
					List<Message> fileMessages = Arrays.asList(objectMapper.readValue(inputStream, Message[].class));
					messages.addAll(fileMessages);
					log.info("Loaded {} messages from {} for module {}", fileMessages.size(), resource.getFilename(), moduleName);
				} catch (IOException e) {
					log.error("Failed to read localization file {}: {}", resource.getFilename(), e.getMessage());
				}
			}
		} catch (IOException e) {
			log.error("Failed to scan localization directories for module {}: {}", moduleName, e.getMessage());
		}

		return messages;
	}

	/**
	 * Load common localizations from localisations/common folder
	 */
	private List<Message> loadCommonLocalizations(ObjectMapper objectMapper) {
		List<Message> messages = new ArrayList<>();

		try {
			PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
			String pattern = "classpath:localisations/common/**/*.json";

			Resource[] resources = resolver.getResources(pattern);

			if (resources.length == 0) {
				log.warn("No common localization files found at path: {}", pattern);
				return messages;
			}

			log.info("Found {} common localization files", resources.length);

			for (Resource resource : resources) {
				try (InputStream inputStream = resource.getInputStream()) {
					List<Message> fileMessages = Arrays.asList(objectMapper.readValue(inputStream, Message[].class));
					messages.addAll(fileMessages);
					log.info("Loaded {} common messages from {}", fileMessages.size(), resource.getFilename());
				} catch (IOException e) {
					log.error("Failed to read localization file {}: {}", resource.getFilename(), e.getMessage());
				}
			}
		} catch (IOException e) {
			log.error("Failed to scan common localization directories: {}", e.getMessage());
		}

		return messages;
	}
}
