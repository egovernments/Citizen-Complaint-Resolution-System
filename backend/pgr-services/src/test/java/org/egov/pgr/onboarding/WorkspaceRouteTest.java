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
        gateway=new WorkspaceGateway(new RestTemplate(),new MockEnvironment().withProperty("egov.user.host","http://127.0.0.1:"+server.getAddress().getPort()),client,mdms,mapper,mock(WorkspaceWriteClient.class));
        mvc=MockMvcBuilders.standaloneSetup(new WorkspaceApiController(new WorkspaceService(repository,gateway,new OnboardingIdentifierService()),new WorkspaceRenamePublisher(repository,gateway))).build();
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
    private void mdms(String schema,String json) throws Exception {when(mdms.records("example",schema,"tenant.tenants".equals(schema)?"example":null)).thenReturn(mapper.readTree(json));}
    private void boundaries(String children) throws Exception {
        mdms("CMS-BOUNDARY.HierarchySchema","[{\"tenantId\":\"example\",\"data\":{\"moduleName\":\"CMS\",\"hierarchy\":\"ADMIN\"}}]");
        when(client.read(eq("boundary"),eq("/boundary-service/boundary-relationships/_search?tenantId=example&hierarchyType=ADMIN&includeChildren=true"),any()))
                .thenReturn(mapper.readTree("{\"TenantBoundary\":[{\"boundary\":[{\"code\":\"COUNTY\",\"children\":"+children+"}]}]}"));
    }
    private static final String WATER="{\"tenantId\":\"example\",\"data\":{\"code\":\"WATER\",\"active\":true}}";
    @Test public void probesExcludePlatformPrerequisitesAndInactiveRows() throws Exception {
        when(mdms.records(eq("example"),anyString(),any())).thenReturn(mapper.readTree("[]"));
        mdms("tenant.tenants","[{\"data\":{\"imageId\":null}}]");
        mdms("common-masters.Department","[{\"tenantId\":\"parent\",\"data\":{\"code\":\"INHERITED\"}},{\"tenantId\":\"example\",\"data\":{\"code\":\"ONBOARDING_ADMIN\"}},{\"isActive\":false,\"data\":{\"code\":\"WATER\"}}]");
        mdms("common-masters.Designation","[{\"tenantId\":\"example\",\"data\":{\"code\":\"ONBOARDING_FOUNDER\"}}]");
        boundaries("[]");
        when(client.read(eq("hrms"),anyString(),any())).thenReturn(mapper.readTree("{\"Employees\":[{\"code\":\"FOUNDER_1\"}]}"));
        assertEquals(List.of(false,false,false,false,false),new ArrayList<>(gateway.probes("example").values()));
        mdms("tenant.tenants","[{\"data\":{\"imageId\":\"logo\"}}]");
        mdms("common-masters.Department","["+WATER+"]");
        mdms("common-masters.Designation","[{\"tenantId\":\"example\",\"data\":{\"code\":\"ENGINEER\"}}]");
        mdms("RAINMAKER-PGR.ComplaintHierarchy","[{\"tenantId\":\"example\",\"data\":{\"code\":\"Water\"}},{\"tenantId\":\"example\",\"data\":{\"code\":\"Leak\",\"parentCode\":\"Water\",\"department\":\"WATER\",\"slaHours\":24}}]");
        boundaries("[{\"code\":\"WARD_1\",\"children\":[]}]");
        hrms(gro("EMP_1","WATER",true,"example"));clearInvocations(client);
        assertEquals(Map.of("BRANDING",true,"GEOGRAPHY",true,"DEPARTMENTS",true,"EMPLOYEES",true,"COMPLAINT_TYPES",true),gateway.probes("example"));
        verify(client,times(1)).read(eq("hrms"),anyString(),any());                                  // EMPLOYEES and COMPLAINT_TYPES share one HRMS read
    }
    private void hrms(String... employees) throws Exception {
        when(client.read(eq("hrms"),anyString(),any())).thenReturn(mapper.readTree("{\"Employees\":["+String.join(",",employees)+"]}"));
    }
    private static String gro(String code,String department,boolean current,String roleTenant) {
        return "{\"code\":\""+code+"\",\"user\":{\"active\":true,\"roles\":[{\"code\":\"EMPLOYEE\",\"tenantId\":\"example\"},{\"code\":\"GRO\",\"tenantId\":\""+roleTenant+"\"}]},"
                +"\"assignments\":[{\"department\":\""+department+"\",\"isCurrentAssignment\":"+current+"}]}";
    }
    @Test public void departmentsNeedARealDesignation() throws Exception {
        mdms("common-masters.Department","["+WATER+"]");
        mdms("common-masters.Designation","[{\"tenantId\":\"example\",\"data\":{\"code\":\"ONBOARDING_FOUNDER\"}},{\"tenantId\":\"parent\",\"data\":{\"code\":\"CLERK\"}},{\"tenantId\":\"example\",\"data\":{\"code\":\"OLD\",\"active\":false}}]");
        assertFalse(gateway.probe("example","DEPARTMENTS"));
        mdms("common-masters.Designation","[{\"tenantId\":\"example\",\"data\":{\"code\":\"CLERK\"}}]");
        assertTrue(gateway.probe("example","DEPARTMENTS"));
        mdms("common-masters.Department","[]");
        assertFalse(gateway.probe("example","DEPARTMENTS"));
    }
    @Test public void complaintTypesNeedALeafWithBothALiveDepartmentAndAnSla() throws Exception {
        mdms("common-masters.Department","["+WATER+",{\"tenantId\":\"example\",\"data\":{\"code\":\"ROADS\",\"active\":false}}]");
        for(String rows:List.of(
                "{\"code\":\"A\",\"department\":\"WATER\"}",                                   // no SLA
                "{\"code\":\"A\",\"slaHours\":24}",                                             // no department
                "{\"code\":\"A\",\"department\":\"ROADS\",\"slaHours\":24}",                 // inactive department
                "{\"code\":\"A\",\"department\":\"GHOST\",\"slaHours\":24}",                 // unknown department
                "{\"code\":\"A\",\"department\":\"WATER\",\"slaHours\":24}},{\"tenantId\":\"example\",\"data\":{\"code\":\"B\",\"parentCode\":\"A\"}")) { // parent, not leaf
            mdms("RAINMAKER-PGR.ComplaintHierarchy","[{\"tenantId\":\"example\",\"data\":"+rows+"}]");
            assertFalse(rows,gateway.probe("example","COMPLAINT_TYPES"));
        }
        verifyNoInteractions(client);                                                                 // no routable leaf: HRMS is never read
        mdms("RAINMAKER-PGR.ComplaintHierarchy","[{\"tenantId\":\"example\",\"data\":{\"code\":\"A\",\"department\":\"WATER\",\"slaHours\":24}}]");
        hrms(gro("EMP_1","WATER",true,"example"));
        assertTrue(gateway.probe("example","COMPLAINT_TYPES"));
    }
    @Test public void complaintTypesNeedACurrentGroInEveryRoutedDepartment() throws Exception {
        String roads="{\"tenantId\":\"example\",\"data\":{\"code\":\"ROADS\",\"active\":true}}";
        mdms("common-masters.Department","["+WATER+","+roads+"]");
        mdms("RAINMAKER-PGR.ComplaintHierarchy","[{\"tenantId\":\"example\",\"data\":{\"code\":\"Leak\",\"department\":\"WATER\",\"slaHours\":24}},"
                +"{\"tenantId\":\"example\",\"data\":{\"code\":\"Pothole\",\"department\":\"ROADS\",\"slaHours\":48}},"
                +"{\"tenantId\":\"example\",\"data\":{\"code\":\"Retired\",\"department\":\"PARKS\",\"slaHours\":8,\"active\":false}}]");
        String nonGro="{\"code\":\"EMP_3\",\"user\":{\"active\":true,\"roles\":[{\"code\":\"PGR_LME\",\"tenantId\":\"example\"}]},\"assignments\":[{\"department\":\"ROADS\",\"isCurrentAssignment\":true}]}";
        hrms(gro("EMP_1","WATER",true,"example"));                                                  // the live bug: ROADS complaints visible to nobody
        assertFalse(gateway.probe("example","COMPLAINT_TYPES"));
        for(String roadsCover:List.of(
                gro("EMP_2","ROADS",false,"example"),                                                // past assignment
                gro("EMP_2","ROADS",true,"other"),                                                   // GRO at another tenant
                nonGro,                                                                              // in ROADS but not GRO
                gro("EMP_2","ROADS",true,"example").replaceFirst("\\{","{\"isActive\":false,"),        // inactive employee
                gro("EMP_2","ROADS",true,"example").replace("\"active\":true","\"active\":false"))) { // disabled user
            hrms(gro("EMP_1","WATER",true,"example"),roadsCover);
            assertFalse(roadsCover,gateway.probe("example","COMPLAINT_TYPES"));
        }
        hrms(gro("EMP_1","WATER",true,"example"),gro("EMP_2","ROADS",true,"example"));               // inactive PARKS leaf needs no GRO
        assertTrue(gateway.probe("example","COMPLAINT_TYPES"));
        when(client.read(eq("hrms"),anyString(),any())).thenThrow(new OnboardingFailure("HRMS_DOWN",true));
        assertThrows(OnboardingFailure.class,()->gateway.probe("example","COMPLAINT_TYPES"));       // unreadable HRMS never grants DONE
    }
    @Test public void geographyNeedsTwoLevelsInTheTenantsOwnHierarchy() throws Exception {
        when(mdms.records(eq("example"),anyString(),any())).thenReturn(mapper.readTree("[]"));
        when(client.read(eq("boundary"),anyString(),any())).thenReturn(mapper.readTree("{\"TenantBoundary\":[{\"boundary\":[{\"code\":\"COUNTY\",\"children\":[{\"code\":\"WARD_1\"}]}]}]}"));
        assertFalse(gateway.probe("example","GEOGRAPHY"));                                           // no HierarchySchema record yet
        mdms("CMS-BOUNDARY.HierarchySchema","[{\"tenantId\":\"example\",\"data\":{\"moduleName\":\"CMS\",\"hierarchy\":\"WORKSPACE\"}}]");
        assertFalse(gateway.probe("example","GEOGRAPHY"));                                           // the founder's reserved root never counts
        mdms("CMS-BOUNDARY.HierarchySchema","[{\"tenantId\":\"parent\",\"data\":{\"moduleName\":\"CMS\",\"hierarchy\":\"ADMIN\"}}]");
        assertFalse(gateway.probe("example","GEOGRAPHY"));                                           // inherited record is not the tenant's
        boundaries("[]");assertFalse(gateway.probe("example","GEOGRAPHY"));
        boundaries("[{\"code\":\"WARD_1\",\"children\":[]}]");assertTrue(gateway.probe("example","GEOGRAPHY"));
    }
    @Test public void unreadableProbeReadsNullOnSearchButFailsTheDoneWrite() throws Exception {
        when(repository.find("example",false)).thenReturn(Optional.of(new LinkedHashMap<>(Map.of("tenantId","example","legacy",false))));
        when(mdms.records(eq("example"),anyString(),any())).thenReturn(mapper.readTree("[]"));
        when(mdms.records("example","tenant.tenants","example")).thenThrow(new OnboardingFailure("MDMS_DOWN",true));
        when(client.read(eq("hrms"),anyString(),any())).thenThrow(new OnboardingFailure("HRMS_DOWN",true));
        boundaries("[]");
        mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json").content(request()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.Probes.BRANDING").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.Probes.EMPLOYEES").value(org.hamcrest.Matchers.nullValue())).andExpect(jsonPath("$.Probes.GEOGRAPHY").value(false));
        when(repository.find("example",true)).thenReturn(Optional.of(new LinkedHashMap<>(Map.of("tenantId","example","version",0L,"legacy",false))));
        mvc.perform(post("/v2/onboarding/workspaces/_update").contentType("application/json").content(request().replace("BRANDING","EMPLOYEES").replace("SKIPPED","DONE")))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.Errors[0].code").value("WORKSPACE_DEPENDENCY_UNAVAILABLE"));
        verify(repository,never()).update(any(),anyLong(),any());
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
