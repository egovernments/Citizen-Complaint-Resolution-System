package org.egov.pgr.onboarding;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

/** Runs only from authenticated _rename; polling/search never executes writes. */
@Service
public class WorkspaceRenamePublisher {
    private final WorkspaceRepository repository;
    private final WorkspaceGateway gateway;
    public WorkspaceRenamePublisher(WorkspaceRepository repository,WorkspaceGateway gateway){this.repository=repository;this.gateway=gateway;}

    // Preserve acknowledged progress when an expired/denied token or dependency stops publication.
    @Transactional(noRollbackFor=ResponseStatusException.class)
    @SuppressWarnings("unchecked")
    public Map<String,Object> publish(Map<String,Object> request) {
        String tenant=request.get("tenantId").toString().trim();
        gateway.requireAdmin(tenant,request);
        repository.find(tenant,true).orElseThrow(); // Serialize with setup updates and other authenticated retries.
        long requestVersion=((Number)request.get("version")).longValue();
        Map<String,Object> rename=repository.rename(tenant,requestVersion).orElseThrow();
        if("DONE".equals(rename.get("status")))return rename;
        List<String> progress=(List<String>)rename.get("progress");String name=rename.get("name").toString();
        try {
            publish(rename,progress,"MDMS",()->gateway.renameMdms(tenant,name,request));
            for(String locale:(List<String>)rename.get("languages"))publish(rename,progress,"LOCALE:"+locale,()->gateway.renameLocale(tenant,name,locale,request));
            publish(rename,progress,"CACHE",()->gateway.bustCache(tenant,request));
            repository.finishRename(rename);
        } catch(OnboardingFailure e) {
            repository.retryRename(rename,e.getCode());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        } catch(ResponseStatusException e) {
            repository.retryRename(rename,e.getReason()==null?"WORKSPACE_DEPENDENCY_UNAVAILABLE":e.getReason());
            throw e;
        }
        return repository.rename(tenant,requestVersion).orElseThrow();
    }
    private void publish(Map<String,Object> rename,List<String> progress,String step,Runnable write) {
        if(progress.contains(step))return;write.run();progress.add(step);repository.renameCheckpoint(rename,progress);
    }
}
