package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

public class WorkspaceWriteClientTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private HttpServer kong,internal;
    private WorkspaceWriteClient writes;
    private WorkspaceGateway gateway;
    private OnboardingProvisionerClient provisioner;
    private MockEnvironment env;
    private final List<Map<String,Object>> calls=new ArrayList<>();
    private final AtomicInteger internalWrites=new AtomicInteger();
    private boolean revokedAtUser;

    @Before public void setup() throws Exception {
        internal=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        internal.createContext("/",exchange->{
            int status;Object response;
            if(exchange.getRequestURI().getPath().equals("/user/_details")) {
                var request=mapper.readTree(exchange.getRequestBody());String token=request.path("RequestInfo").path("authToken").asText();
                status=revokedAtUser?401:200;
                response=Map.of("uuid","admin","active",true,"roles",List.of(Map.of("code",token.equals("nonadmin")?"EMPLOYEE":"ACCOUNT_ADMIN","tenantId","example")));
            } else {internalWrites.incrementAndGet();status=500;response=Map.of("unexpected","internal write");}
            byte[] bytes=mapper.writeValueAsBytes(response);exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });internal.start();
        kong=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        kong.createContext("/",exchange->{
            Map<String,Object> request=mapper.readValue(exchange.getRequestBody(),Map.class);
            String path=exchange.getRequestURI().getPath();calls.add(Map.of("path",path,"request",request));
            String token=((Map<?,?>)request.get("RequestInfo")).get("authToken").toString();
            int status=token.equals("expired")?401:Set.of("nonadmin","revoked").contains(token)?403:200;
            exchange.getResponseHeaders().add("Content-Type","application/json");
            if(status==200&&path.endsWith("cache-bust"))exchange.sendResponseHeaders(status,-1);
            else {byte[] bytes=mapper.writeValueAsBytes(Map.of("ok",status==200));exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);}
            exchange.close();
        });kong.start();
        String host="http://127.0.0.1:"+internal.getAddress().getPort();
        env=new MockEnvironment().withProperty("egov.gateway.host","http://127.0.0.1:"+kong.getAddress().getPort())
                .withProperty("egov.user.host",host).withProperty("egov.mdms.host",host).withProperty("egov.localization.host",host);
        writes=new WorkspaceWriteClient(new RestTemplate(),env);provisioner=mock(OnboardingProvisionerClient.class);
        var mdms=mock(OnboardingSteps.class);
        when(mdms.records("example","tenant.tenants","example")).thenAnswer(call->mapper.valueToTree(List.of(Map.of("tenantId","example","data",Map.of("name","New Name")))));
        gateway=new WorkspaceGateway(new RestTemplate(),env,provisioner,mdms,mapper,writes);
    }
    @After public void stop(){if(kong!=null)kong.stop(0);if(internal!=null)internal.stop(0);}
    private Map<String,Object> request(String token){return Map.of("RequestInfo",Map.of("authToken",token,"userInfo",Map.of("uuid","forged","roles",List.of("SUPERUSER"))));}

    @Test public void allWritesUseFixedKongRoutesCurrentTokenAndSanitizedRequestInfo() {
        gateway.renameMdms("example","New Name",request("caller"));
        gateway.renameLocale("example","New Name","en_IN",request("caller"));
        gateway.bustCache("example",request("caller"));
        assertEquals(List.of("/mdms-v2/v2/_update/tenant.tenants","/localization/messages/v1/_upsert","/localization/messages/cache-bust"),calls.stream().map(c->c.get("path")).toList());
        for(var call:calls){Map<?,?> info=(Map<?,?>)((Map<?,?>)call.get("request")).get("RequestInfo");assertEquals("caller",info.get("authToken"));assertFalse(info.containsKey("userInfo"));}
        assertEquals(0,internalWrites.get());verifyNoInteractions(provisioner);
    }
    @Test public void kongDenialAndRevocationNeverFallBackToInternalProvisioner() {
        for(String token:List.of("nonadmin","expired","revoked")) {
            ResponseStatusException failure=assertThrows(ResponseStatusException.class,()->writes.updateTenant(Map.of("tenantId","example"),token));
            assertEquals(token.equals("expired")?401:403,failure.getStatusCode().value());
        }
        assertEquals(3,calls.size());assertEquals(0,internalWrites.get());verifyNoInteractions(provisioner);
    }
    @Test public void liveAuthorityChecksAlsoProtectAuthOptionalCacheBust() {
        assertEquals(403,assertThrows(ResponseStatusException.class,()->gateway.bustCache("example",request("nonadmin"))).getStatusCode().value());
        revokedAtUser=true;
        assertEquals(401,assertThrows(ResponseStatusException.class,()->gateway.bustCache("example",request("caller"))).getStatusCode().value());
        assertTrue(calls.isEmpty());assertEquals(0,internalWrites.get());verifyNoInteractions(provisioner);
    }
    @Test public void expiredAfterLiveCheckStillCannotWriteThroughKong() {
        assertEquals(401,assertThrows(ResponseStatusException.class,()->gateway.renameMdms("example","New Name",request("expired"))).getStatusCode().value());
        assertEquals(1,calls.size());assertEquals(0,internalWrites.get());verifyNoInteractions(provisioner);
    }
    @Test public void missingOrNonOriginGatewayConfigurationFailsClosed() {
        for(String origin:List.of("","http://example.invalid/path","http://user:pass@example.invalid","http://example.invalid?redirect=true")) {
            env.setProperty("egov.gateway.host",origin);
            assertEquals(503,assertThrows(ResponseStatusException.class,()->writes.bustCache("caller")).getStatusCode().value());
        }
        assertTrue(calls.isEmpty());assertEquals(0,internalWrites.get());verifyNoInteractions(provisioner);
    }
}
