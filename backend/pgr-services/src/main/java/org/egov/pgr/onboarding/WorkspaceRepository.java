package org.egov.pgr.onboarding;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Repository
public class WorkspaceRepository {
    public static final List<String> STEPS = List.of("BRANDING", "GEOGRAPHY", "DEPARTMENTS", "EMPLOYEES", "COMPLAINT_TYPES");
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public WorkspaceRepository(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }

    public static Map<String,Object> initialSteps(String state, Long now, String actor) {
        Map<String,Object> steps = new LinkedHashMap<>();
        for (String step : STEPS) {
            Map<String,Object> value = new LinkedHashMap<>();
            value.put("state", state); value.put("updatedAt", now); value.put("updatedBy", actor); steps.put(step,value);
        }
        return steps;
    }
    /**
     * Live tenants this service onboarded or adopted, for background jobs that scan them alongside the state
     * tenant's cities: every signup whose provisioning succeeded (ACTIVE) plus every workspace row (legacy rows
     * included). The workspace checklist status is deliberately ignored: a tenant whose setup is NOT_STARTED,
     * IN_PROGRESS or set back still takes complaints.
     */
    public List<String> onboardedTenantIds() {
        return jdbc.queryForList("SELECT requested_tenant_id FROM eg_pgr_onboarding_signup WHERE status='ACTIVE' " +
                "UNION SELECT tenant_id FROM eg_pgr_onboarding_workspace ORDER BY 1", String.class);
    }
    public Optional<Map<String,Object>> find(String tenant, boolean lock) {
        return jdbc.query("SELECT tenant_id,status,steps,version,seed_version,updated_at,updated_by FROM eg_pgr_onboarding_workspace WHERE tenant_id = ?" + (lock ? " FOR UPDATE" : ""),
                (rs,n) -> {
                    Map<String,Object> row = new LinkedHashMap<>(); row.put("tenantId",rs.getString("tenant_id")); row.put("status",rs.getString("status"));
                    row.put("steps",read(rs.getString("steps"))); row.put("version",rs.getLong("version")); row.put("seedVersion",rs.getString("seed_version"));
                    row.put("updatedAt",rs.getObject("updated_at")); row.put("updatedBy",rs.getString("updated_by")); row.put("legacy",rs.getString("seed_version")==null); return row;
                }, tenant).stream().findFirst();
    }
    public void materializeLegacy(String tenant) {
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace(tenant_id,status,steps,version) VALUES (?,'DONE',?::jsonb,0) ON CONFLICT DO NOTHING",
                tenant,json(initialSteps("DONE", null, null)));
    }
    public void update(Map<String,Object> row, long expected, String actor) {
        long now=System.currentTimeMillis();
        if (jdbc.update("UPDATE eg_pgr_onboarding_workspace SET status=?,steps=?::jsonb,version=version+1,updated_at=?,updated_by=? WHERE tenant_id=? AND version=?",
                row.get("status"),json(row.get("steps")),now,actor,row.get("tenantId"),expected)!=1) conflict("WORKSPACE_VERSION_CONFLICT");
        row.put("version",expected+1); row.put("updatedAt",now); row.put("updatedBy",actor);
    }
    public void event(String tenant,String type,long version,Object details,String actor) {
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_event(id,tenant_id,event_type,version,details,created_at,created_by) VALUES (?,?,?,?,?::jsonb,?,?)",
                UUID.randomUUID(),tenant,type,version,json(details),System.currentTimeMillis(),actor);
    }
    public Optional<Map<String,Object>> rename(String tenant, Long requestVersion) {
        return jdbc.query("SELECT id,tenant_id,name,normalized_name,old_normalized_name,request_version,version,status,languages,progress,updated_at,updated_by,last_error_code " +
                        "FROM eg_pgr_onboarding_workspace_rename WHERE tenant_id=?" + (requestVersion==null ? " ORDER BY version DESC LIMIT 1" : " AND request_version=?"),
                (rs,n)-> {
                    Map<String,Object> row=new LinkedHashMap<>();
                    row.put("id",rs.getObject("id").toString()); row.put("tenantId",rs.getString("tenant_id")); row.put("name",rs.getString("name"));
                    row.put("normalizedName",rs.getString("normalized_name")); row.put("oldNormalizedName",rs.getString("old_normalized_name"));
                    row.put("requestVersion",rs.getLong("request_version")); row.put("version",rs.getLong("version")); row.put("status",rs.getString("status"));
                    row.put("languages",readList(rs.getString("languages"))); row.put("progress",readList(rs.getString("progress")));
                    row.put("updatedAt",rs.getLong("updated_at")); row.put("updatedBy",rs.getString("updated_by"));
                    if(rs.getString("last_error_code")!=null)row.put("lastErrorCode",rs.getString("last_error_code")); return row;
                },requestVersion==null ? new Object[]{tenant} : new Object[]{tenant,requestVersion}).stream().findFirst();
    }
    public boolean nameAvailable(String tenant,String name) {
        return jdbc.queryForObject("SELECT count(*) FROM eg_pgr_onboarding_workspace_name WHERE normalized_name=? AND tenant_id<>?",Integer.class,name,tenant)==0;
    }
    public void reserveName(String tenant,String name) {
        if(jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_name(normalized_name,tenant_id) VALUES (?,?) ON CONFLICT(normalized_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id WHERE eg_pgr_onboarding_workspace_name.tenant_id=EXCLUDED.tenant_id",name,tenant)!=1)
            conflict("WORKSPACE_NAME_TAKEN");
    }
    public Map<String,Object> beginRename(String tenant,String name,String normalized,String oldName,long version,List<String> languages,String actor) {
        UUID id=UUID.randomUUID(); long now=System.currentTimeMillis();
        jdbc.update("INSERT INTO eg_pgr_onboarding_workspace_rename(id,tenant_id,name,normalized_name,old_normalized_name,request_version,version,status,languages,updated_at,updated_by,next_attempt_at) VALUES (?,?,?,?,?,?,?,'PENDING',?::jsonb,?,?,?)",
                id,tenant,name,normalized,oldName,version,version+1,json(languages),now,actor,now);
        return rename(tenant,version).orElseThrow();
    }
    public void renameCheckpoint(Map<String,Object> rename,List<String> progress) {
        jdbc.update("UPDATE eg_pgr_onboarding_workspace_rename SET progress=?::jsonb,updated_at=?,last_error_code=NULL WHERE id=? AND status='PENDING'",
                json(progress),System.currentTimeMillis(),UUID.fromString(rename.get("id").toString()));
    }
    public void finishRename(Map<String,Object> rename) {
        // Claim completion before any side effect. The caller's transaction retains this row lock.
        if (jdbc.update("UPDATE eg_pgr_onboarding_workspace_rename SET status='DONE',updated_at=?,last_error_code=NULL WHERE id=? AND status='PENDING'",
                System.currentTimeMillis(),UUID.fromString(rename.get("id").toString())) != 1) return;
        String tenant=rename.get("tenantId").toString(), name=rename.get("normalizedName").toString();
        jdbc.update("DELETE FROM eg_pgr_onboarding_workspace_name WHERE tenant_id=? AND normalized_name=? AND normalized_name<>?",tenant,rename.get("oldNormalizedName"),name);
        jdbc.update("UPDATE eg_pgr_onboarding_identifier SET status='RELEASED' WHERE identifier_type='ORGANIZATION_NAME' AND normalized_value<>? AND signup_id IN (SELECT id FROM eg_pgr_onboarding_signup WHERE requested_tenant_id=?)",name,tenant);
        jdbc.update("UPDATE eg_pgr_onboarding_signup SET account_name=?,updated_at=? WHERE requested_tenant_id=? AND status='ACTIVE'",rename.get("name"),System.currentTimeMillis(),tenant);
        event(tenant,"RENAME_DONE",((Number)rename.get("version")).longValue(),Map.of("renameId",rename.get("id")),rename.get("updatedBy").toString());
    }
    public void retryRename(Map<String,Object> rename,String code) {
        jdbc.update("UPDATE eg_pgr_onboarding_workspace_rename SET attempts=attempts+1,next_attempt_at=?+LEAST(300000,1000*power(2,LEAST(attempts,8))),updated_at=?,last_error_code=? WHERE id=? AND status='PENDING'",
                System.currentTimeMillis(),System.currentTimeMillis(),code,UUID.fromString(rename.get("id").toString()));
    }
    public String json(Object value) { try{return mapper.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);} }
    private Map<String,Object> read(String value){try{return mapper.readValue(value,new TypeReference<LinkedHashMap<String,Object>>(){});}catch(Exception e){throw new IllegalStateException(e);}}
    private List<String> readList(String value){try{return mapper.readValue(value,new TypeReference<ArrayList<String>>(){});}catch(Exception e){throw new IllegalStateException(e);}}
    public static void conflict(String code){throw new ResponseStatusException(HttpStatus.CONFLICT,code);}
}
