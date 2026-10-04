package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.egov.pgr.web.controllers.WorkspaceApiController;
import org.junit.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestTemplate;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real HTTP token lookup with no BFF dependency; Kong deployment is a separate gate. */
public class WorkspaceRouteTest {
    private HttpServer server; private MockMvc mvc; private ObjectMapper mapper=new ObjectMapper();
    private Map<String,Object> currentUser; private AtomicInteger lookups=new AtomicInteger();
    private WorkspaceRepository repository; private WorkspaceGateway gateway; private OnboardingSteps mdms; private OnboardingProvisionerClient client;
    @Before public void setup() throws Exception {
        currentUser=Map.of("uuid","admin","active",true,"roles",List.of(Map.of("code","ACCOUNT_ADMIN","tenantId","example")));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/user/_details",exchange->{
            lookups.incrementAndGet();assertEquals("access_token=normal-token",exchange.getRequestURI().getRawQuery());
            Map<?,?> request=mapper.readValue(exchange.getRequestBody(),Map.class);
            assertEquals("normal-token",((Map<?,?>)request.get("RequestInfo")).get("authToken"));
            byte[] response=mapper.writeValueAsBytes(currentUser);exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.sendResponseHeaders(200,response.length);exchange.getResponseBody().write(response);exchange.close();
        });server.start();
        repository=mock(WorkspaceRepository.class);mdms=mock(OnboardingSteps.class);client=mock(OnboardingProvisionerClient.class);
        gateway=new WorkspaceGateway(new RestTemplate(),new MockEnvironment().withProperty("egov.user.host","http://127.0.0.1:"+server.getAddress().getPort()),client,mdms,mapper);
        mvc=MockMvcBuilders.standaloneSetup(new WorkspaceApiController(new WorkspaceService(repository,gateway,new OnboardingIdentifierService()))).build();
    }
    @After public void stop(){if(server!=null)server.stop(0);}
    private String request(){return "{\"RequestInfo\":{\"authToken\":\"normal-token\",\"userInfo\":{\"roles\":[{\"code\":\"ACCOUNT_ADMIN\",\"tenantId\":\"example\"}]}},\"tenantId\":\"example\",\"version\":0,\"name\":\"New Name\",\"step\":\"BRANDING\",\"state\":\"SKIPPED\"}";}
    @Test public void normalDigitTokenReturnsLegacyWithoutProbesAndFreshlyChecksEachRequest() throws Exception {
        for(int i=0;i<2;i++)mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json").content(request()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.Workspace.legacy").value(true)).andExpect(jsonPath("$.Workspace.status").value("DONE"));
        assertEquals(2,lookups.get());verifyNoInteractions(client,mdms);
    }
    @Test public void allRoutesRejectForgedCallerRoleAndCrossTenantAdmin() throws Exception {
        for(Map<String,Object> user:List.of(Map.<String,Object>of("uuid","admin","roles",List.of(Map.of("code","EMPLOYEE","tenantId","example"))),
                Map.<String,Object>of("uuid","admin","roles",List.of(Map.of("code","ACCOUNT_ADMIN","tenantId","other"))))) {
            currentUser=user;
            for(String path:List.of("_search","_update","_rename"))mvc.perform(post("/v2/onboarding/workspaces/"+path).contentType("application/json").content(request()))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.Errors[0].code").value("WORKSPACE_ADMIN_REQUIRED"));
        }
        verifyNoInteractions(repository,client,mdms);
    }
    @Test public void absentTokenAndDisabledUserAreUnauthorized() throws Exception {
        mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json").content("{\"tenantId\":\"example\"}" )).andExpect(status().isUnauthorized());
        assertEquals(0,lookups.get());currentUser=Map.of("uuid","admin","active",false,"roles",List.of());
        mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json").content(request())).andExpect(status().isUnauthorized());verifyNoInteractions(repository);
    }
    @Test public void probesExcludePlatformPrerequisitesAndInactiveRows() throws Exception {
        when(mdms.records(eq("example"),anyString(),any())).thenReturn(mapper.readTree("[]"));
        when(mdms.records("example","tenant.tenants","example")).thenReturn(mapper.readTree("[{\"data\":{\"imageId\":null}}]"));
        when(mdms.records("example","common-masters.Department",null)).thenReturn(mapper.readTree("[{\"tenantId\":\"parent\",\"data\":{\"code\":\"INHERITED\"}},{\"tenantId\":\"example\",\"data\":{\"code\":\"ONBOARDING_ADMIN\"}},{\"isActive\":false,\"data\":{\"code\":\"WATER\"}}]"));
        when(client.post(eq("boundary"),anyString(),any())).thenReturn(mapper.readTree("{\"Boundary\":[{\"code\":\"example\"}]}"));
        when(client.post(eq("hrms"),anyString(),any())).thenReturn(mapper.readTree("{\"Employees\":[{\"code\":\"FOUNDER_1\"}]}"));
        assertTrue(gateway.probes("example").values().stream().noneMatch(Boolean.TRUE::equals));
        when(mdms.records("example","tenant.tenants","example")).thenReturn(mapper.readTree("[{\"data\":{\"imageId\":\"logo\"}}]"));
        when(mdms.records("example","common-masters.Department",null)).thenReturn(mapper.readTree("[{\"tenantId\":\"example\",\"data\":{\"code\":\"WATER\",\"active\":true}}]"));
        when(mdms.records("example","RAINMAKER-PGR.ComplaintHierarchy",null)).thenReturn(mapper.readTree("[{\"tenantId\":\"example\",\"data\":{\"department\":\"WATER\",\"slaHours\":24}}]"));
        when(client.post(eq("boundary"),anyString(),any())).thenReturn(mapper.readTree("{\"Boundary\":[{\"code\":\"WARD_1\"}]}"));
        when(client.post(eq("hrms"),anyString(),any())).thenReturn(mapper.readTree("{\"Employees\":[{\"code\":\"EMP_1\",\"user\":{\"active\":true}}]}"));
        assertTrue(gateway.probes("example").values().stream().allMatch(Boolean.TRUE::equals));
    }
    @Test public void unreadableProbeReturns503InsteadOfFalseReadiness() throws Exception {
        when(repository.find("example",false)).thenReturn(Optional.of(new LinkedHashMap<>(Map.of("tenantId","example","legacy",false))));
        when(mdms.records("example","tenant.tenants","example")).thenThrow(new OnboardingFailure("MDMS_DOWN",true));
        mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json").content(request()))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.Errors[0].code").value("WORKSPACE_DEPENDENCY_UNAVAILABLE"));
    }
    @Test public void unreadableBffNameCheckReturns503WithoutRenameWrites() throws Exception {
        when(repository.find("example",true)).thenReturn(Optional.of(new LinkedHashMap<>(Map.of("tenantId","example","version",0L))));
        when(repository.nameAvailable("example","new name")).thenReturn(true);
        when(mdms.records("example","tenant.tenants","example")).thenReturn(mapper.readTree("[{\"data\":{\"name\":\"Old Name\"}}]"));
        when(client.identity(eq("identifiers/_check"),any())).thenThrow(new OnboardingFailure("IDENTITY_UNAVAILABLE",true));
        mvc.perform(post("/v2/onboarding/workspaces/_rename").contentType("application/json").content(request()))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.Errors[0].code").value("WORKSPACE_DEPENDENCY_UNAVAILABLE"));
        verify(repository,never()).reserveName(any(),any());verify(repository,never()).beginRename(any(),any(),any(),any(),anyLong(),anyList(),any());
    }

    @Test public void unreadableLocalReservationReturns503WithoutRenameWrites() throws Exception {
        when(repository.find("example",true)).thenReturn(Optional.of(new LinkedHashMap<>(Map.of("tenantId","example","version",0L))));
        when(mdms.records("example","tenant.tenants","example")).thenReturn(mapper.readTree("[{\"data\":{\"name\":\"Old Name\"}}]"));
        when(repository.nameAvailable("example","new name")).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("database unavailable"));
        assertDatabaseFailureWithoutRenameWrites();
        verifyNoInteractions(client);
    }
    @Test public void unreadableWorkspaceRowReturns503BeforeNameChecksOrRenameWrites() throws Exception {
        when(repository.find("example",true)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("database unavailable"));
        assertDatabaseFailureWithoutRenameWrites();
        verify(repository,never()).nameAvailable(any(),any());verifyNoInteractions(client,mdms);
    }
    private void assertDatabaseFailureWithoutRenameWrites() throws Exception {
        mvc.perform(post("/v2/onboarding/workspaces/_rename").contentType("application/json").content(request()))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.Errors[0].code").value("WORKSPACE_DEPENDENCY_UNAVAILABLE"))
                .andExpect(jsonPath("$.Errors[0].message").value("WORKSPACE_DEPENDENCY_UNAVAILABLE"));
        verify(repository,never()).reserveName(any(),any());verify(repository,never()).update(any(),anyLong(),any());
        verify(repository,never()).beginRename(any(),any(),any(),any(),anyLong(),anyList(),any());
        verify(repository,never()).event(any(),any(),anyLong(),any(),any());
    }

}
