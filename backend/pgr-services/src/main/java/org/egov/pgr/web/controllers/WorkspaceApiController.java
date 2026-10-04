package org.egov.pgr.web.controllers;

import org.egov.pgr.onboarding.OnboardingFailure;
import org.egov.pgr.onboarding.WorkspaceService;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@RestController
@RequestMapping("/v2/onboarding/workspaces")
public class WorkspaceApiController {
    private final WorkspaceService service;
    public WorkspaceApiController(WorkspaceService service){this.service=service;}
    @PostMapping("/_search") public Map<String,Object> search(@RequestBody Map<String,Object> request){return service.search(request);}
    @PostMapping("/_update") public Map<String,Object> update(@RequestBody Map<String,Object> request){return service.update(request);}
    @PostMapping("/_rename") public ResponseEntity<Map<String,Object>> rename(@RequestBody Map<String,Object> request){return ResponseEntity.accepted().body(service.rename(request));}
    @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<Map<String,Object>> failure(ResponseStatusException e){return error(e.getStatusCode().value(),e.getReason()==null?"WORKSPACE_INVALID_REQUEST":e.getReason());}
    @ExceptionHandler(OnboardingFailure.class) public ResponseEntity<Map<String,Object>> dependency(OnboardingFailure e){return error(503,"WORKSPACE_DEPENDENCY_UNAVAILABLE");}
    @ExceptionHandler(DataAccessException.class) public ResponseEntity<Map<String,Object>> database(DataAccessException e){return error(503,"WORKSPACE_DEPENDENCY_UNAVAILABLE");}
    private ResponseEntity<Map<String,Object>> error(int status,String code){return ResponseEntity.status(status).body(Map.of("Errors",List.of(Map.of("code",code,"message",code))));}
}
