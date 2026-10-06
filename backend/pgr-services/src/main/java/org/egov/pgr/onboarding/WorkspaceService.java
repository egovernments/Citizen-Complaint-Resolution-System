package org.egov.pgr.onboarding;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class WorkspaceService {
    private final WorkspaceRepository repository;
    private final WorkspaceGateway gateway;
    private final OnboardingIdentifierService identifiers;
    public WorkspaceService(WorkspaceRepository repository,WorkspaceGateway gateway,OnboardingIdentifierService identifiers) {
        this.repository=repository;this.gateway=gateway;this.identifiers=identifiers;
    }
    public Map<String,Object> search(Map<String,Object> request) {
        String tenant=tenant(request);gateway.requireAdmin(tenant,request);
        return response(tenant,repository.find(tenant,false).orElse(null));
    }
    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String,Object> update(Map<String,Object> request) {
        String tenant=tenant(request), actor=gateway.requireAdmin(tenant,request);
        long version=version(request);String step=text(request,"step"), state=text(request,"state");
        if(!WorkspaceRepository.STEPS.contains(step)||!Set.of("NOT_STARTED","IN_PROGRESS","DONE","SKIPPED").contains(state)
                ||("SKIPPED".equals(state)&&!"BRANDING".equals(step))) WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_STATE");
        Map<String,Object> row=repository.find(tenant,true).orElse(null);
        if(row==null){if(version!=0)WorkspaceRepository.conflict("WORKSPACE_VERSION_CONFLICT");return response(tenant,null);}
        if(((Number)row.get("version")).longValue()!=version)WorkspaceRepository.conflict("WORKSPACE_VERSION_CONFLICT");
        if(Boolean.TRUE.equals(row.get("legacy")))return response(row,null,repository.rename(tenant,null).orElse(null));
        // Only DONE needs evidence, and only for its own step: other writes must not depend on MDMS, boundary or HRMS.
        Map<String,Boolean> probes="DONE".equals(state)?Map.of(step,gateway.probe(tenant,step)):null;
        if(probes!=null&&!probes.get(step)) WorkspaceRepository.conflict("WORKSPACE_PROBE_INCOMPLETE");
        Map<String,Object> steps=(Map<String,Object>)row.get("steps");
        steps.put(step,new LinkedHashMap<>(Map.of("state",state,"updatedAt",System.currentTimeMillis(),"updatedBy",actor)));
        boolean done=steps.values().stream().allMatch(v->Set.of("DONE","SKIPPED").contains(((Map<?,?>)v).get("state")));
        boolean unstarted=steps.values().stream().allMatch(v->"NOT_STARTED".equals(((Map<?,?>)v).get("state")));
        row.put("status",done?"DONE":unstarted?"NOT_STARTED":"IN_PROGRESS");
        repository.update(row,version,actor);
        repository.event(tenant,"STEP_UPDATED",version+1,Map.of("step",step,"state",state),actor);
        return response(row,probes,repository.rename(tenant,null).orElse(null));
    }
    @Transactional
    public Map<String,Object> rename(Map<String,Object> request) {
        String tenant=tenant(request),actor=gateway.requireAdmin(tenant,request),name=text(request,"name").replaceAll("\\s+"," ");
        if(name.length()>200)WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_NAME");
        long version=version(request);String normalized=identifiers.normalizeOrganizationName(name);
        if(normalized.isBlank())WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_NAME");
        repository.materializeLegacy(tenant); // insert-or-ignore serializes two first renames of a legacy tenant
        Map<String,Object> workspace=repository.find(tenant,true).orElseThrow();
        Optional<Map<String,Object>> replay=repository.rename(tenant,version);
        if(replay.isPresent()) {
            if(!normalized.equals(replay.get().get("normalizedName")))WorkspaceRepository.conflict("WORKSPACE_VERSION_CONFLICT");
            return Map.of("Rename",publicRename(replay.get()));
        }
        if(((Number)workspace.get("version")).longValue()!=version)WorkspaceRepository.conflict("WORKSPACE_VERSION_CONFLICT");
        if(repository.rename(tenant,null).filter(r->"PENDING".equals(r.get("status"))).isPresent())WorkspaceRepository.conflict("WORKSPACE_RENAME_PENDING");
        String oldName=identifiers.normalizeOrganizationName(gateway.tenant(tenant).path("data").path("name").asText());
        if(!repository.nameAvailable(tenant,normalized))WorkspaceRepository.conflict("WORKSPACE_NAME_TAKEN");
        if(!normalized.equals(oldName))gateway.requireNameAvailable(normalized);
        List<String> locales=gateway.languages(tenant);
        // An onboarded tenant owns rainmaker-common only where the baseline seeded it; its name key anywhere else
        // would hide `default` for that locale (#2257). Legacy tenants keep their own packs, so every locale stays.
        if(!Boolean.TRUE.equals(workspace.get("legacy")))locales=locales.stream().filter(gateway::seedsTenantNameModule).toList();
        repository.reserveName(tenant,oldName);repository.reserveName(tenant,normalized);
        repository.update(workspace,version,actor);
        Map<String,Object> rename=repository.beginRename(tenant,name,normalized,oldName,version,locales,actor);
        repository.event(tenant,"RENAME_ACCEPTED",version+1,Map.of("renameId",rename.get("id")),actor);
        return Map.of("Rename",publicRename(rename));
    }
    private Map<String,Object> response(String tenant,Map<String,Object> row) {
        if(row==null){
            row=new LinkedHashMap<>();row.put("tenantId",tenant);row.put("status","DONE");row.put("steps",WorkspaceRepository.initialSteps("DONE",null,null));
            row.put("version",0L);row.put("seedVersion",null);row.put("updatedAt",null);row.put("updatedBy",null);row.put("legacy",true);
            return response(row,null,null);
        }
        return response(row,Boolean.TRUE.equals(row.get("legacy"))?null:gateway.probes(tenant),repository.rename(tenant,null).orElse(null));
    }
    private Map<String,Object> response(Map<String,Object> row,Map<String,Boolean> probes,Map<String,Object> rename){
        Map<String,Object> result=new LinkedHashMap<>();result.put("Workspace",row);result.put("Probes",probes);result.put("Rename",publicRename(rename));return result;
    }
    public static Map<String,Object> publicRename(Map<String,Object> rename){
        if(rename==null)return null;Map<String,Object> result=new LinkedHashMap<>();
        for(String key:List.of("id","tenantId","name","version","status","updatedAt","lastErrorCode"))if(rename.containsKey(key))result.put(key,rename.get(key));return result;
    }
    private String tenant(Map<String,Object> request){String tenant=text(request,"tenantId");if(!tenant.matches("[a-zA-Z0-9][a-zA-Z0-9.-]{0,255}"))WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_TENANT");return tenant;}
    private String text(Map<String,Object> request,String key){Object value=request.get(key);if(!(value instanceof String)||((String)value).isBlank())WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_REQUEST");return value.toString().trim();}
    private long version(Map<String,Object> request){Object version=request.get("version");if(!(version instanceof Number)||((Number)version).longValue()<0||((Number)version).doubleValue()!=((Number)version).longValue())WorkspaceGateway.fail(HttpStatus.BAD_REQUEST,"WORKSPACE_INVALID_REQUEST");return ((Number)version).longValue();}
}
