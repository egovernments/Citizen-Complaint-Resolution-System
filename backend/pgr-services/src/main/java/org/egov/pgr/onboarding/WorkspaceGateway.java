package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Component
public class WorkspaceGateway {
    private final RestTemplate http;
    private final Environment env;
    private final OnboardingProvisionerClient client;
    private final OnboardingSteps mdms;
    private final ObjectMapper mapper;
    public WorkspaceGateway(RestTemplate shared,Environment env,OnboardingProvisionerClient client,OnboardingSteps mdms,ObjectMapper mapper) {
        this.http=new RestTemplate(shared.getMessageConverters()); var factory=new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000); factory.setReadTimeout(10000); http.setRequestFactory(factory);
        this.env=env;this.client=client;this.mdms=mdms;this.mapper=mapper;
    }
    public String requireAdmin(String tenant,Map<String,Object> request) {
        Object info=request.get("RequestInfo");
        Object token=info instanceof Map ? ((Map<?,?>)info).get("authToken") : null;
        if(!(token instanceof String) || ((String)token).isBlank()) fail(HttpStatus.UNAUTHORIZED,"WORKSPACE_AUTH_REQUIRED");
        try {
            JsonNode response=http.postForObject(env.getRequiredProperty("egov.user.host").replaceAll("/$","")+
                    "/user/_details?access_token="+URLEncoder.encode(token.toString(),StandardCharsets.UTF_8),
                    Map.of("RequestInfo",Map.of("authToken",token)),JsonNode.class);
            JsonNode user=response==null?mapper.nullNode():response.has("UserRequest")?response.get("UserRequest"):response;
            if(user.path("uuid").asText().isBlank() || !user.path("active").asBoolean(true)) fail(HttpStatus.UNAUTHORIZED,"WORKSPACE_AUTH_REQUIRED");
            for(JsonNode role:user.path("roles")) if("ACCOUNT_ADMIN".equals(role.path("code").asText()) && tenant.equals(role.path("tenantId").asText())) return user.path("uuid").asText();
            fail(HttpStatus.FORBIDDEN,"WORKSPACE_ADMIN_REQUIRED");
            return null;
        } catch(RestClientResponseException e) {
            fail(e.getStatusCode().is4xxClientError()?HttpStatus.UNAUTHORIZED:HttpStatus.SERVICE_UNAVAILABLE,
                    e.getStatusCode().is4xxClientError()?"WORKSPACE_AUTH_REQUIRED":"WORKSPACE_DEPENDENCY_UNAVAILABLE");return null;
        } catch(RestClientException e){fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");return null;}
    }
    public Map<String,Boolean> probes(String tenant) {
        Map<String,Boolean> probes=new LinkedHashMap<>();
        JsonNode tenantRecord=tenant(tenant);
        probes.put("BRANDING",!tenantRecord.path("data").path("imageId").asText("").isBlank());
        boolean department=false;
        for(JsonNode row:mdms.records(tenant,"common-masters.Department",null)) if(ownedActive(row,tenant) && !row.path("data").path("code").asText().isBlank() && !"ONBOARDING_ADMIN".equals(row.path("data").path("code").asText())) department=true;
        probes.put("DEPARTMENTS",department);
        boolean complaint=false;
        for(JsonNode row:mdms.records(tenant,"RAINMAKER-PGR.ComplaintHierarchy",null)) if(ownedActive(row,tenant) && (!row.path("data").path("department").asText("").isBlank()||row.path("data").path("slaHours").asDouble(0)>0)) complaint=true;
        probes.put("COMPLAINT_TYPES",complaint);
        JsonNode boundaries=client.post("boundary","/boundary-service/boundary/_search?tenantId="+tenant+"&limit=1000",Map.of()).path("Boundary");
        requireArray(boundaries); boolean geography=false;
        for(JsonNode boundary:boundaries) if(!boundary.path("code").asText().isBlank() && !tenant.equals(boundary.path("code").asText()) && boundary.path("isActive").asBoolean(true))geography=true;
        probes.put("GEOGRAPHY",geography);
        JsonNode employees=client.post("hrms","/egov-hrms/employees/_search?tenantId="+tenant+"&limit=1000",Map.of()).path("Employees");
        requireArray(employees);boolean employee=false;
        for(JsonNode row:employees) if(!row.path("code").asText().isBlank() && !row.path("code").asText().startsWith("FOUNDER_") && row.path("isActive").asBoolean(true) && row.path("user").path("active").asBoolean(true))employee=true;
        probes.put("EMPLOYEES",employee);
        return probes;
    }
    public JsonNode tenant(String tenant) {
        JsonNode rows=mdms.records(tenant,"tenant.tenants",tenant);
        if(rows.size()!=1 || !active(rows.get(0))) fail(HttpStatus.CONFLICT,"WORKSPACE_TENANT_NOT_FOUND");
        return rows.get(0);
    }
    public List<String> languages(String tenant) {
        JsonNode info=mdms.records(tenant,"common-masters.StateInfo",tenant);
        if(info.size()!=1)throw new OnboardingFailure("TENANT_LANGUAGES_MISSING",true);
        List<String> locales=new ArrayList<>();
        for(JsonNode language:info.get(0).path("data").path("languages")) {
            String value=language.path("value").asText(); if(!value.isBlank()&&!locales.contains(value))locales.add(value);
        }
        if(locales.isEmpty())throw new OnboardingFailure("TENANT_LANGUAGES_MISSING",true);
        return locales;
    }
    public void requireNameAvailable(String normalized) {
        JsonNode response=client.identity("identifiers/_check",Map.of("identifiers",List.of(Map.of("type","ORGANIZATION_NAME","value",normalized))));
        JsonNode results=response==null?mapper.nullNode():response.path("results");
        if(!results.isArray() || results.size()!=1) fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        JsonNode result=results.get(0);
        if(!"ORGANIZATION_NAME".equals(result.path("type").asText()) || !normalized.equals(result.path("value").asText()) || !result.path("available").isBoolean())
            fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        if(!result.path("available").asBoolean()) WorkspaceRepository.conflict("WORKSPACE_NAME_TAKEN");
    }
    public void renameMdms(String tenant,String name) {
        var record=mapper.convertValue(tenant(tenant),new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String,Object>>(){});
        @SuppressWarnings("unchecked") var data=(Map<String,Object>)record.get("data");
        data.put("name",name);
        client.post("mdms","/egov-mdms-service/v2/_update/tenant.tenants",Map.of("Mdms",record));
        if(!name.equals(tenant(tenant).path("data").path("name").asText()))throw new OnboardingFailure("TENANT_NAME_NOT_VISIBLE",true);
    }
    public void renameLocale(String tenant,String name,String locale) {
        client.post("localization","/localization/messages/v1/_upsert",Map.of("tenantId",tenant,"messages",List.of(Map.of(
                "code","TENANT_TENANTS_"+tenant.toUpperCase(Locale.ROOT),"message",name,"locale",locale,"module","rainmaker-common"))));
    }
    public void bustCache(){client.bustLocalizationCache();}
    private boolean ownedActive(JsonNode row,String tenant){return tenant.equals(row.path("tenantId").asText()) && active(row);}
    private boolean active(JsonNode row){return row.path("isActive").asBoolean(true)&&row.path("data").path("active").asBoolean(true);}
    private void requireArray(JsonNode rows){if(!rows.isArray())throw new OnboardingFailure("WORKSPACE_INVALID_DEPENDENCY_RESPONSE",true);}
    public static void fail(HttpStatus status,String code){throw new ResponseStatusException(status,code);}
}
