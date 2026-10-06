package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Before;
import org.junit.Test;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

public class WorkspaceServiceTest {
    private WorkspaceRepository repository;
    private WorkspaceGateway gateway;
    private WorkspaceService service;
    private Map<String,Object> row;
    @Before public void setup(){
        repository=mock(WorkspaceRepository.class);gateway=mock(WorkspaceGateway.class);
        service=new WorkspaceService(repository,gateway,new OnboardingIdentifierService());
        when(gateway.requireAdmin(eq("test"),any())).thenReturn("admin");
        when(repository.nameAvailable(anyString(),anyString())).thenReturn(true);
        row=new LinkedHashMap<>(Map.of("tenantId","test","version",1L,"status","NOT_STARTED","legacy",false,
                "steps",WorkspaceRepository.initialSteps("NOT_STARTED",1L,"admin")));
    }
    @Test public void legacySearchDoesNotWriteOrProbe(){
        when(repository.find("test",false)).thenReturn(Optional.empty());
        Map<String,Object> result=service.search(Map.of("tenantId","test"));
        assertNull(result.get("Probes"));assertNull(result.get("Rename"));
        Map<?,?> workspace=(Map<?,?>)result.get("Workspace");assertEquals(true,workspace.get("legacy"));
        assertEquals("DONE",workspace.get("status"));assertNull(workspace.get("updatedAt"));
        verify(gateway,never()).probes(any());verify(repository,never()).materializeLegacy(any());
    }
    @Test public void doneRequiresProbeAndOnlyBrandingCanSkip(){
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.probe("test","DEPARTMENTS")).thenReturn(false);
        assertEquals("WORKSPACE_PROBE_INCOMPLETE",assertThrows(ResponseStatusException.class,()->service.update(request("DEPARTMENTS","DONE",1))).getReason());
        assertEquals("WORKSPACE_INVALID_STATE",assertThrows(ResponseStatusException.class,()->service.update(request("DEPARTMENTS","SKIPPED",1))).getReason());
        verify(repository,never()).update(any(),anyLong(),any());verify(gateway,never()).probes(any());
        verify(gateway,never()).probe(eq("test"),argThat(step->!"DEPARTMENTS".equals(step)));
    }
    @Test public void doneProbesOnlyItsOwnStep(){
        when(repository.find("test",true)).thenReturn(Optional.of(row));when(gateway.probe("test","GEOGRAPHY")).thenReturn(true);
        Map<String,Object> result=service.update(request("GEOGRAPHY","DONE",1));
        assertEquals(Map.of("GEOGRAPHY",true),result.get("Probes"));
        verify(gateway).probe("test","GEOGRAPHY");verify(gateway,never()).probes(any());
    }
    @Test public void inProgressAndSkippedWritesNeverProbeSoDependencyOutagesCannotBlockThem(){
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.probe(any(),any())).thenThrow(new OnboardingFailure("HRMS_DOWN",true));when(gateway.probes(any())).thenThrow(new OnboardingFailure("HRMS_DOWN",true));
        assertNull(service.update(request("EMPLOYEES","IN_PROGRESS",1)).get("Probes"));
        assertNull(service.update(request("BRANDING","SKIPPED",1)).get("Probes"));
        verify(gateway,never()).probe(any(),any());verify(gateway,never()).probes(any());
    }
    @Test public void staleVersionCannotWriteOrProbe(){
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        assertEquals("WORKSPACE_VERSION_CONFLICT",assertThrows(ResponseStatusException.class,()->service.update(request("BRANDING","SKIPPED",0))).getReason());
        verify(gateway,never()).probes(any());
    }
    @Test public void overallDoneRequiresEveryStepDoneOrBrandingSkipped(){
        row.put("steps",WorkspaceRepository.initialSteps("DONE",1L,"admin"));
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        Map<String,Object> result=service.update(request("BRANDING","SKIPPED",1));
        assertEquals("DONE",((Map<?,?>)result.get("Workspace")).get("status"));
        verify(repository).event(eq("test"),eq("STEP_UPDATED"),eq(2L),any(),eq("admin"));
    }
    @Test public void renameReplayPrecedesVersionConflictAndReturnsCurrentState(){
        row.put("version",5L);when(repository.find("test",true)).thenReturn(Optional.of(row));
        Map<String,Object> rename=new LinkedHashMap<>(Map.of("id","rename","tenantId","test","name","New Name","normalizedName","new name","version",2L,"status","DONE","updatedAt",2L));
        when(repository.rename("test",1L)).thenReturn(Optional.of(rename));
        Map<?,?> result=(Map<?,?>)service.rename(Map.of("tenantId","test","name","  NEW   NAME ","version",1)).get("Rename");
        assertEquals("DONE",result.get("status"));assertEquals(2L,result.get("version"));assertFalse(result.containsKey("normalizedName"));
        verify(repository,never()).reserveName(any(),any());
        verify(gateway,never()).requireNameAvailable(any());
    }
    @Test public void newRenameCapturesAllLanguagesAndHoldsBothNames(){
        row.put("legacy",true);
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.tenant("test")).thenReturn(new ObjectMapper().valueToTree(Map.of("data",Map.of("name","Old Name"))));
        when(gateway.languages("test")).thenReturn(List.of("en_IN","hi_IN"));
        when(repository.beginRename(any(),any(),any(),any(),anyLong(),anyList(),any())).thenReturn(Map.of("id","rename","status","PENDING","version",2L));
        service.rename(Map.of("tenantId","test","name","New Name","version",1));
        verify(repository).reserveName("test","old name");verify(repository).reserveName("test","new name");
        verify(repository).beginRename("test","New Name","new name","old name",1L,List.of("en_IN","hi_IN"),"admin");
    }
    /** An onboarded tenant owns rainmaker-common only where the baseline seeded it; the name key never goes elsewhere (#2257). */
    @Test public void onboardedRenameSkipsLocalesWithoutTheSeededTenantNamePack(){
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.tenant("test")).thenReturn(new ObjectMapper().valueToTree(Map.of("data",Map.of("name","Old Name"))));
        when(gateway.languages("test")).thenReturn(List.of("en_IN","hi_IN","sw_KE"));
        when(gateway.seedsTenantNameModule("en_IN")).thenReturn(true);
        when(repository.beginRename(any(),any(),any(),any(),anyLong(),anyList(),any())).thenReturn(Map.of("id","rename","status","PENDING","version",2L));
        service.rename(Map.of("tenantId","test","name","New Name","version",1));
        verify(repository).beginRename("test","New Name","new name","old name",1L,List.of("en_IN"),"admin");
    }
    @Test public void partialRenameRetriesOnlyUnacknowledgedWrites(){
        Map<String,Object> rename=new LinkedHashMap<>(Map.of("id",UUID.randomUUID().toString(),"tenantId","test","name","New Name","version",2L,
                "languages",List.of("en_IN","hi_IN"),"progress",new ArrayList<>(List.of("MDMS","LOCALE:en_IN")),"status","PENDING"));
        when(repository.find("test",true)).thenReturn(Optional.of(row));when(repository.rename("test",1L)).thenReturn(Optional.of(rename));
        doThrow(new OnboardingFailure("LOCALIZATION_DOWN",true)).doNothing().when(gateway).renameLocale(eq("test"),eq("New Name"),eq("hi_IN"),any());
        WorkspaceRenamePublisher publisher=new WorkspaceRenamePublisher(repository,gateway);
        assertThrows(ResponseStatusException.class,()->publisher.publish(Map.of("tenantId","test","version",1L)));verify(repository).retryRename(rename,"LOCALIZATION_DOWN");verify(repository,never()).finishRename(any());
        publisher.publish(Map.of("tenantId","test","version",1L));verify(repository).finishRename(rename);verify(gateway).bustCache(eq("test"),any());
        verify(gateway,never()).renameMdms(any(),any(),any());verify(gateway,never()).renameLocale(eq("test"),eq("New Name"),eq("en_IN"),any());
    }
    @Test public void unchangedAuthoritativeNameSkipsExternalSelfCollision() {
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.tenant("test")).thenReturn(new ObjectMapper().valueToTree(Map.of("data",Map.of("name","Old Name"))));
        when(gateway.languages("test")).thenReturn(List.of("en_IN"));
        when(repository.beginRename(any(),any(),any(),any(),anyLong(),anyList(),any())).thenReturn(Map.of("id","rename","status","PENDING","version",2L));
        service.rename(Map.of("tenantId","test","name"," OLD   NAME ","version",1));
        verify(gateway,never()).requireNameAvailable(any());
    }
    @Test public void localConflictPrecedesBffAndOccupiedLegacyNameCannotReserve() {
        when(repository.find("test",true)).thenReturn(Optional.of(row));
        when(gateway.tenant("test")).thenReturn(new ObjectMapper().valueToTree(Map.of("data",Map.of("name","Old Name"))));
        when(repository.nameAvailable("test","new name")).thenReturn(false);
        assertEquals("WORKSPACE_NAME_TAKEN",assertThrows(ResponseStatusException.class,()->service.rename(Map.of("tenantId","test","name","New Name","version",1))).getReason());
        verify(gateway,never()).requireNameAvailable(any());
        when(repository.nameAvailable("test","new name")).thenReturn(true);
        doThrow(new ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,"WORKSPACE_NAME_TAKEN")).when(gateway).requireNameAvailable("new name");
        assertEquals("WORKSPACE_NAME_TAKEN",assertThrows(ResponseStatusException.class,()->service.rename(Map.of("tenantId","test","name","New Name","version",1))).getReason());
        verify(repository,never()).reserveName(any(),any());verify(repository,never()).update(any(),anyLong(),any());
    }
    private Map<String,Object> request(String step,String state,long version){return Map.of("tenantId","test","step",step,"state",state,"version",version);}
}
