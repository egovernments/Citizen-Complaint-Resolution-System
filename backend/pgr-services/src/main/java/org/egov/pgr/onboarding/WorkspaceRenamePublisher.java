package org.egov.pgr.onboarding;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
public class WorkspaceRenamePublisher {
    private final WorkspaceRepository repository;
    private final WorkspaceGateway gateway;
    public WorkspaceRenamePublisher(WorkspaceRepository repository,WorkspaceGateway gateway){this.repository=repository;this.gateway=gateway;}
    @Scheduled(fixedDelayString="${pgr.onboarding.rename.poll-ms:5000}")
    @Transactional
    @SuppressWarnings("unchecked")
    public void publishPending(){
        for(String tenant:repository.pendingRenames()){
            Map<String,Object> rename=repository.rename(tenant,null).orElseThrow();
            List<String> progress=(List<String>)rename.get("progress");String name=rename.get("name").toString();
            try{
                publish(rename,progress,"MDMS",()->gateway.renameMdms(tenant,name));
                for(String locale:(List<String>)rename.get("languages"))publish(rename,progress,"LOCALE:"+locale,()->gateway.renameLocale(tenant,name,locale));
                publish(rename,progress,"CACHE",gateway::bustCache);
                repository.finishRename(rename);
            }catch(OnboardingFailure e){repository.retryRename(rename,e.getCode());}
            catch(ResponseStatusException e){repository.retryRename(rename,e.getReason()==null?"WORKSPACE_DEPENDENCY_UNAVAILABLE":e.getReason());}
        }
    }
    private void publish(Map<String,Object> rename,List<String> progress,String step,Runnable write){
        if(progress.contains(step))return;write.run();progress.add(step);repository.renameCheckpoint(rename,progress);
    }
}
