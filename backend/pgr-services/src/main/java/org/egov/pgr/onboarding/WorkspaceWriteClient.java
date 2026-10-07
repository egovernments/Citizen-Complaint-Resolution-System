package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.core.env.Environment;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;
import java.net.URI;
import java.util.Map;

/** Fixed workspace actions through Kong. Caller credentials exist only during this request. */
@Component
public class WorkspaceWriteClient {
    private final RestTemplate http;
    private final Environment env;

    public WorkspaceWriteClient(RestTemplate shared,Environment env) {
        this.http=new RestTemplate(shared.getMessageConverters());
        var factory=new SimpleClientHttpRequestFactory();factory.setConnectTimeout(2000);factory.setReadTimeout(10000);
        http.setRequestFactory(factory);this.env=env;
    }
    public void updateTenant(Map<String,Object> record,String token) {
        write("/mdms-v2/v2/_update/tenant.tenants",Map.of("Mdms",record),token,false);
    }
    public void upsertLocale(Map<String,Object> body,String token) {
        write("/localization/messages/v1/_upsert",body,token,false);
    }
    public void bustCache(String token) {
        write("/localization/messages/cache-bust",Map.of(),token,true);
    }
    private String origin() {
        try {
            URI uri=URI.create(env.getProperty("egov.gateway.host",""));
            if(!("http".equals(uri.getScheme())||"https".equals(uri.getScheme())) || uri.getHost()==null || uri.getUserInfo()!=null
                    || uri.getQuery()!=null || uri.getFragment()!=null || !(uri.getPath().isEmpty()||"/".equals(uri.getPath()))) throw new IllegalArgumentException();
            return uri.toString().replaceAll("/$","");
        } catch(IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE"); }
    }
    private void write(String path,Map<String,Object> body,String token,boolean emptyAllowed) {
        if(token==null||token.isBlank())WorkspaceGateway.fail(HttpStatus.UNAUTHORIZED,"WORKSPACE_AUTH_REQUIRED");
        var request=new java.util.LinkedHashMap<String,Object>(body);
        request.put("RequestInfo",Map.of("apiId","pgr-workspace","authToken",token,"ts",System.currentTimeMillis()));
        HttpHeaders headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            var response=http.postForEntity(origin()+path,new HttpEntity<>(request,headers),JsonNode.class);
            if(!response.getStatusCode().is2xxSuccessful() || (!emptyAllowed && response.getBody()==null))
                WorkspaceGateway.fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        } catch(RestClientResponseException e) {
            if(e.getStatusCode().value()==401)WorkspaceGateway.fail(HttpStatus.UNAUTHORIZED,"WORKSPACE_AUTH_REQUIRED");
            if(e.getStatusCode().value()==403)WorkspaceGateway.fail(HttpStatus.FORBIDDEN,"WORKSPACE_ADMIN_REQUIRED");
            WorkspaceGateway.fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE");
        } catch(RestClientException e) { WorkspaceGateway.fail(HttpStatus.SERVICE_UNAVAILABLE,"WORKSPACE_DEPENDENCY_UNAVAILABLE"); }
    }
}
