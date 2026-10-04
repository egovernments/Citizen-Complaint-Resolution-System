package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestTemplate;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.Assert.*;

public class OnboardingProvisionerClientTest {
    private HttpServer server;private OnboardingProvisionerClient client;private int status=204;
    @Before public void setup() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/user/oauth/token",e->{byte[] b="{\"access_token\":\"fixture-only\",\"UserRequest\":{\"uuid\":\"provisioner\"}}".getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().add("Content-Type","application/json");e.sendResponseHeaders(200,b.length);e.getResponseBody().write(b);e.close();});
        server.createContext("/",e->{e.getRequestBody().readAllBytes();
            if(status==204){e.sendResponseHeaders(204,-1);}else{byte[] b="{\"Errors\":[{\"code\":\"EMPLOYEE_ALREADY_EXISTS\"}]}".getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().add("Content-Type","application/json");e.sendResponseHeaders(status,b.length);e.getResponseBody().write(b);}e.close();});
        server.start();String base="http://127.0.0.1:"+server.getAddress().getPort();
        var env=new MockEnvironment().withProperty("egov.user.host",base).withProperty("egov.localization.host",base).withProperty("egov.hrms.host",base)
                .withProperty("pgr.onboarding.provisioner.username","test-only").withProperty("pgr.onboarding.provisioner.password","test-only").withProperty("pgr.onboarding.provisioner.tenant-id","pg");
        client=new OnboardingProvisionerClient(new RestTemplate(),new ObjectMapper(),env);
    }
    @After public void stop(){if(server!=null)server.stop(0);}
    @Test public void onlyFixedCacheBustAcceptsSuccessfulEmptyBody(){
        client.bustLocalizationCache();
        OnboardingFailure failure=assertThrows(OnboardingFailure.class,()->client.post("hrms","/egov-hrms/employees/_search",Map.of()));
        assertEquals("EMPTY_PROVISIONING_RESPONSE",failure.getCode());assertTrue(failure.isRetryable());
    }
    @Test public void errorEnvelopePreservesDuplicateClassificationAndServerFailuresRetry(){
        status=400;OnboardingFailure rejected=assertThrows(OnboardingFailure.class,()->client.post("hrms","/egov-hrms/employees/_create",Map.of()));
        assertEquals("EMPLOYEE_ALREADY_EXISTS",rejected.getCode());assertFalse(rejected.isRetryable());
        status=503;assertTrue(assertThrows(OnboardingFailure.class,client::bustLocalizationCache).isRetryable());
    }
}
