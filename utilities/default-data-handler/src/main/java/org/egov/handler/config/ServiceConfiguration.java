package org.egov.handler.config;

import lombok.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
@Data
@NoArgsConstructor
@AllArgsConstructor
@Setter
@Getter
public class ServiceConfiguration {

    @Value("${kafka.topics.create.tenant}")
    private String createTopic;

    //MDMS Configs
    @Value("${egov.mdms.host}${egov.mdms.default.data.create.endpoint}")
    private String mdmsDefaultDataCreateURI;

    @Value("${egov.mdms.host}${egov.mdms.schema.create.endpoint}")
    private String mdmsSchemaCreateURI;

    @Value("${egov.mdms.host}${egov.mdms.schema.search.endpoint}")
    private String mdmsSchemaSearchURI;

    @Value("${egov.mdms.host}${egov.mdms.data.create.endpoint}")
    private String mdmsDataCreateURI;

    @Value("${egov.mdms.host}${egov.mdms.data.search.endpoint}")
    private String mdmsDataSearchURI;

    @Value("#{'${default.mdms.schema.create.list}'.split(',')}")
    private List<String> defaultMdmsSchemaList;

    @Value("#{${mdms.schemacode.map}}")
    private Map<String, List<String>> mdmsSchemacodeMap;

    //Localization Configs
    @Value("${egov.localization.host}${egov.localization.default.data.create.endpoint}")
    private String localizationDefaultDataCreateURI;

    @Value("${egov.localization.host}${egov.localization.upsert.path}")
    private String upsertLocalizationURI;

    @Value("#{'${default.localization.locale.list}'.split(',')}")
    private List<String> defaultLocalizationLocaleList;

    @Value("#{'${default.localization.module.create.list}'.split(',')}")
    private List<String> defaultLocalizationModuleList;

    @Value("${tenant.localization.module}")
    private String tenantLocalizationModule;

    // User Config
    @Value("${egov.user.host}")
    private String userHost;

    @Value("${egov.user.context.path}")
    private String userContextPath;

    @Value("${egov.user.create.path}")
    private String userCreateEndpoint;

    @Value("${egov.user.search.path}")
    private String userSearchEndpoint;

    @Value("${egov.user.update.path}")
    private String userUpdateEndpoint;

    // User OTP Configuration
    @Value("${egov.user.otp.host}")
    private String userOtpHost;

    @Value("${egov.user.otp.send.endpoint}")
    private String userOtpSendEndpoint;

    // Tenant Management Configuration
    @Value("${egov.tenant.management.host}${egov.tenant.management.context.path}${egov.tenant.management.config.create.path}")
    private String tenantConfigCreateURI;

    @Value("${egov.tenant.management.host}${egov.tenant.management.context.path}${egov.tenant.management.config.search.path}")
    private String tenantConfigSearchURI;

    // Default Tenant Id
    @Value("${default.tenant.id}")
    private String defaultTenantId;

    // Workflow Configuration
    @Value("${egov.workflow.host}${egov.workflow.businessservice.create.path}")
    private String wfBusinessServiceCreateURI;

    // HRMS configuration
    @Value("${egov.hrms.host}")
    private String hrmsHost;

    @Value("${egov.hrms.path}")
    private String hrmsCreatePath;

    // Elastic Search Configuration
    @Value("${egov.indexer.es.username}")
    private String EsUsername;

    @Value("${egov.indexer.es.password}")
    private String EsPassword;

    @Value("${egov.infra.indexer.host}")
    private String elasticsearchHost;

    @Value("${elasticsearch.port}")
    private int elasticsearchPort;

    @Value("${egov.bulk.index.path}")
    private String bulkIndexPath;

    @Value("${topic.notification.mail}")
    private String emailTopic;

    @Value("${egov.boundary.host}${egov.boundary.hierarchy.definition.create}")
    private String hierarchyDefinitionCreateUri;

    @Value("${egov.boundary.host}${egov.boundary.entity.create}")
    private String boundaryEntityCreateUri;

    @Value("${egov.boundary.host}${egov.boundary.relationship.create}")
    private String boundaryRelationshipCreateUri;

    @Value("${scheduler.max.executions}")
    private String maxExecution;

    @Value("${dev.enabled}")
    private boolean devEnabled;

    // Module list - comma separated list of modules to load
    @Value("${module.list:}")
    private String moduleListString;

    // PROD Common paths
    @Value("${prod.common.schema.path}")
    private String prodCommonSchemaPath;

    @Value("${prod.common.mdms.data.path}")
    private String prodCommonMdmsDataPath;

    @Value("${prod.common.localization.data.path}")
    private String prodCommonLocalizationDataPath;

    @Value("${prod.common.workflow.data.path}")
    private String prodCommonWorkflowDataPath;

    // PROD Module path patterns
    @Value("${prod.module.schema.path}")
    private String prodModuleSchemaPathPattern;

    @Value("${prod.module.mdms.data.path}")
    private String prodModuleMdmsDataPathPattern;

    @Value("${prod.module.localization.data.path}")
    private String prodModuleLocalizationDataPathPattern;

    @Value("${prod.module.workflow.data.path}")
    private String prodModuleWorkflowDataPathPattern;

    // DEV Common paths
    @Value("${dev.common.schema.path}")
    private String devCommonSchemaPath;

    @Value("${dev.common.mdms.data.path}")
    private String devCommonMdmsDataPath;

    @Value("${dev.common.localization.data.path}")
    private String devCommonLocalizationDataPath;

    @Value("${dev.common.workflow.data.path}")
    private String devCommonWorkflowDataPath;

    // DEV Module path patterns
    @Value("${dev.module.schema.path}")
    private String devModuleSchemaPathPattern;

    @Value("${dev.module.mdms.data.path}")
    private String devModuleMdmsDataPathPattern;

    @Value("${dev.module.localization.data.path}")
    private String devModuleLocalizationDataPathPattern;

    @Value("${dev.module.workflow.data.path}")
    private String devModuleWorkflowDataPathPattern;

    // User and Employee data files
    @Value("${default.user.data.file}")
    private String defaultUserDataFile;

    @Value("${default.employee.data.file}")
    private String defaultEmployeeDataFile;

    @Value("${dev.user.data.file}")
    private String devUserDataFile;

    @Value("${dev.employee.data.file}")
    private String devEmployeeDataFile;

    // Legacy/Module-specific file paths
    @Value("${pgr.indexer.file}")
    private String pgrIndexerFile;

    @Value("${pgr.workflow.config.file}")
    private String pgrWorkflowConfigFile;

    @Value("${default.hrms.template.file}")
    private String defaultHrmsTemplateFile;

    /**
     * Get the list of enabled modules
     * @return List of module names, empty list if no modules configured
     */
    public List<String> getModuleList() {
        if (moduleListString == null || moduleListString.trim().isEmpty()) {
            return List.of();
        }
        return List.of(moduleListString.split(",")).stream()
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    /**
     * Get module-specific path by replacing {moduleName} placeholder
     * @param pathPattern The path pattern with {moduleName} placeholder
     * @param moduleName The module name to substitute
     * @return The resolved path
     */
    public String getModulePath(String pathPattern, String moduleName) {
        return pathPattern.replace("{moduleName}", moduleName.toLowerCase());
    }
}
