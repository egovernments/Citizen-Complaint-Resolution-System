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
    private final WorkspaceWriteClient writes;
    public WorkspaceGateway(RestTemplate shared,Environment env,OnboardingProvisionerClient client,OnboardingSteps mdms,ObjectMapper mapper,WorkspaceWriteClient writes) {
        this.http=new RestTemplate(shared.getMessageConverters()); var factory=new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000); factory.setReadTimeout(10000); http.setRequestFactory(factory);
        this.env=env;this.client=client;this.mdms=mdms;this.mapper=mapper;this.writes=writes;
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
    /** Advisory readout for _search: a probe whose dependency fails reads null instead of failing the call. */
    public Map<String,Boolean> probes(String tenant) {
        Map<String,Boolean> probes=new LinkedHashMap<>(); Reads reads=new Reads(tenant);
        for(String step:WorkspaceRepository.STEPS) try{probes.put(step,probe(reads,step));}catch(RuntimeException e){probes.put(step,null);}
        return probes;
    }
    /** One step's live check; dependency failures propagate so DONE is never granted on an unreadable probe. */
    public boolean probe(String tenant,String step){return probe(new Reads(tenant),step);}
    private boolean probe(Reads reads,String step) {
        String tenant=reads.tenant;
        switch(step) {
            case "BRANDING": return !tenant(tenant).path("data").path("imageId").asText("").isBlank();
            case "DEPARTMENTS": {
                if(departments(tenant).isEmpty())return false;
                for(JsonNode row:mdms.records(tenant,"common-masters.Designation",null)) if(ownedActive(row,tenant) && !code(row).isBlank() && !"ONBOARDING_FOUNDER".equals(code(row)))return true;
                return false;
            }
            case "COMPLAINT_TYPES": {
                Set<String> departments=departments(tenant), parents=new HashSet<>(); List<JsonNode> rows=new ArrayList<>();
                for(JsonNode row:mdms.records(tenant,"RAINMAKER-PGR.ComplaintHierarchy",null)) if(ownedActive(row,tenant)) {rows.add(row);parents.add(row.path("data").path("parentCode").asText(""));}
                // A leaf is a row nothing else names as its parent; it must route to a live department with an SLA.
                boolean routable=false; Set<String> routed=new HashSet<>();
                for(JsonNode row:rows) if(!code(row).isBlank() && !parents.contains(code(row))) {
                    String department=row.path("data").path("department").asText("");
                    if(!department.isBlank())routed.add(department);
                    if(departments.contains(department) && row.path("data").path("slaHours").asDouble(0)>0)routable=true;
                }
                if(!routable)return false;
                // GRO ABAC is department OWN: a department with no GRO strands its complaints in PENDINGFORASSIGNMENT.
                for(JsonNode row:reads.employees()) if(row.path("isActive").asBoolean(true) && row.path("user").path("active").asBoolean(true) && hasRole(row,"GRO",tenant))
                    for(JsonNode assignment:row.path("assignments")) if(assignment.path("isCurrentAssignment").asBoolean(false))routed.remove(assignment.path("department").asText(""));
                return routed.isEmpty();
            }
            case "GEOGRAPHY": {
                // The founder's hierarchy is the one the tenant's CMS HierarchySchema names; the baseline's WORKSPACE root never counts.
                String hierarchy=null;
                for(JsonNode row:mdms.records(tenant,"CMS-BOUNDARY.HierarchySchema",null)) if(ownedActive(row,tenant) && "CMS".equals(row.path("data").path("moduleName").asText()))hierarchy=row.path("data").path("hierarchy").asText("");
                if(hierarchy==null || hierarchy.isBlank() || "WORKSPACE".equals(hierarchy))return false;
                JsonNode trees=client.read("boundary","/boundary-service/boundary-relationships/_search?tenantId="+tenant+"&hierarchyType="+URLEncoder.encode(hierarchy,StandardCharsets.UTF_8)+"&includeChildren=true",Map.of()).path("TenantBoundary");
                requireArray(trees);
                // At least two levels: some root has a child.
                for(JsonNode tree:trees) for(JsonNode root:tree.path("boundary"))
                    for(JsonNode child:root.path("children")) if(!child.path("code").asText().isBlank())return true;
                return false;
            }
            case "EMPLOYEES": {
                for(JsonNode row:reads.employees()) if(!row.path("code").asText().isBlank() && !row.path("code").asText().startsWith("FOUNDER_") && row.path("isActive").asBoolean(true) && row.path("user").path("active").asBoolean(true))return true;
                return false;
            }
            default: throw new IllegalArgumentException(step);
        }
    }
    /** Dependency reads shared by the probes of one call, so EMPLOYEES and COMPLAINT_TYPES read HRMS once. */
    private final class Reads {
        final String tenant; private JsonNode employees; private RuntimeException employeesFailure;
        Reads(String tenant){this.tenant=tenant;}
        JsonNode employees() {
            if(employeesFailure!=null)throw employeesFailure;
            if(employees==null) try {
                JsonNode rows=client.read("hrms","/egov-hrms/employees/_search?tenantId="+tenant+"&offset=0&limit=1000",Map.of()).path("Employees");
                requireArray(rows); employees=rows;
            } catch(RuntimeException e){employeesFailure=e;throw e;}
            return employees;
        }
    }
    private static boolean hasRole(JsonNode employee,String role,String tenant) {
        for(JsonNode r:employee.path("user").path("roles")) if(role.equals(r.path("code").asText()) && tenant.equals(r.path("tenantId").asText()))return true;
        return false;
    }
    private Set<String> departments(String tenant) {
        Set<String> codes=new HashSet<>();
        for(JsonNode row:mdms.records(tenant,"common-masters.Department",null)) if(ownedActive(row,tenant) && !code(row).isBlank() && !"ONBOARDING_ADMIN".equals(code(row)))codes.add(code(row));
        return codes;
    }
    private static String code(JsonNode row){return row.path("data").path("code").asText("");}
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
    public boolean seedsTenantNameModule(String locale){return mdms.seedsTenantNameModule(locale);}
    public void requireNameAvailable(String normalized) {
        JsonNode response=client.identity("identifiers/_check",Map.of("identifiers",List.of(Map.of("type","ORGANIZATION_NAME","value",normalized))));
        JsonNode results=response==null?mapper.nullNode():response.path("results");
        if(!results.isArray() || results.size()!=1) fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        JsonNode result=results.get(0);
        if(!"ORGANIZATION_NAME".equals(result.path("type").asText()) || !normalized.equals(result.path("value").asText()) || !result.path("available").isBoolean())
            fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        if(!result.path("available").asBoolean()) WorkspaceRepository.conflict("WORKSPACE_NAME_TAKEN");
    }
    public void renameMdms(String tenant,String name,Map<String,Object> request) {
        var record=mapper.convertValue(tenant(tenant),new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String,Object>>(){});
        @SuppressWarnings("unchecked") var data=(Map<String,Object>)record.get("data");
        data.put("name",name);
        writes.updateTenant(record,authorizedToken(tenant,request));
        if(!name.equals(tenant(tenant).path("data").path("name").asText()))throw new OnboardingFailure("TENANT_NAME_NOT_VISIBLE",true);
    }
    public void renameLocale(String tenant,String name,String locale,Map<String,Object> request) {
        writes.upsertLocale(Map.of("tenantId",tenant,"messages",List.of(Map.of(
                "code","TENANT_TENANTS_"+tenant.toUpperCase(Locale.ROOT),"message",name,"locale",locale,"module","rainmaker-common"))),authorizedToken(tenant,request));
    }
    public void bustCache(String tenant,Map<String,Object> request){writes.bustCache(authorizedToken(tenant,request));}
    private String authorizedToken(String tenant,Map<String,Object> request) {
        requireAdmin(tenant,request);
        return ((Map<?,?>)request.get("RequestInfo")).get("authToken").toString();
    }
    private boolean ownedActive(JsonNode row,String tenant){return tenant.equals(row.path("tenantId").asText()) && active(row);}
    private boolean active(JsonNode row){return row.path("isActive").asBoolean(true)&&row.path("data").path("active").asBoolean(true);}
    private void requireArray(JsonNode rows){if(!rows.isArray())throw new OnboardingFailure("WORKSPACE_INVALID_DEPENDENCY_RESPONSE",true);}
    public static void fail(HttpStatus status,String code){throw new ResponseStatusException(status,code);}
}
