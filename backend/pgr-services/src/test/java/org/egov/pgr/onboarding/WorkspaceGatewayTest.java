package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.*;
import org.egov.pgr.web.controllers.WorkspaceApiController;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.util.UriComponentsBuilder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.net.InetSocketAddress;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Executes the fixed internal HTTP endpoints; no caller-selected host or path. */
public class WorkspaceGatewayTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private WorkspaceGateway gateway;
    private OnboardingProvisionerClient client;
    private int hrmsStatus = 200;
    private List<Map<String,Object>> employees = List.of(Map.of("code","EMP_1","isActive",true,"user",Map.of("active",true)));
    private JsonNode nameCheck;
    private int nameStatus;
    private String tenantName;
    private final List<Map<String,Object>> requests = new ArrayList<>();
    private final Map<String,String> labels = new LinkedHashMap<>();
    private boolean cacheBusted;

    @Before public void setup() throws Exception {
        tenantName="Old Name"; nameStatus=200;
        nameCheck=mapper.valueToTree(Map.of("results",List.of(Map.of("type","ORGANIZATION_NAME","value","new name","available",true))));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            String path=exchange.getRequestURI().getPath();
            String body=new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            Object response; int status=200;
            if(path.equals("/user/oauth/token")) response=Map.of("access_token","internal-token","UserRequest",Map.of("uuid","provisioner"));
            else {
                Map<String,Object> request=mapper.readValue(body,Map.class);
                requests.add(Map.of("path",path,"body",request,"authorization",Objects.toString(exchange.getRequestHeaders().getFirst("Authorization"),""),"query",Objects.toString(exchange.getRequestURI().getRawQuery(),"")));
                switch(path) {
                    case "/user/_details" -> response=Map.of("uuid","admin","active",true,"roles",List.of(Map.of("code","ACCOUNT_ADMIN","tenantId","example")));
                    case "/boundary-service/boundary-relationships/_search" -> response=Map.of("TenantBoundary",List.of(Map.of("boundary",List.of(Map.of("code","example","children",List.of())))));
                    case "/egov-hrms/employees/_search" -> {
                        var query=UriComponentsBuilder.fromUri(exchange.getRequestURI()).build().getQueryParams();
                        // Stock EmployeeQueryBuilder needs both boxed pagination fields.
                        // Reject the pre-fix request instead of silently supplying defaults.
                        boolean pagination=query.containsKey("offset") && query.containsKey("limit");
                        if(pagination) {
                            try {pagination=Integer.parseInt(query.getFirst("offset"))>=0 && Integer.parseInt(query.getFirst("limit"))>0;}
                            catch(NumberFormatException e) {pagination=false;}
                        }
                        status=pagination?hrmsStatus:500;
                        response=status==200?Map.of("Employees",employees):Map.of("Errors",List.of(Map.of("code","HRMS_SEARCH_FAILED")));
                    }
                    case "/internal/identity/v1/identifiers/_check" -> { response=nameCheck;status=nameStatus; }
                    case "/egov-mdms-service/v2/_search" -> {
                        String schema=((Map<?,?>)request.get("MdmsCriteria")).get("schemaCode").toString();
                        response=Map.of("mdms",switch(schema) {
                            case "tenant.tenants" -> List.of(Map.of("id","tenant-record","tenantId","example","uniqueIdentifier","example","data",Map.of("code","example","name",tenantName)));
                            case "common-masters.StateInfo" -> List.of(Map.of("tenantId","example","data",Map.of("languages",List.of(Map.of("value","en_IN"),Map.of("value","hi_IN")))));
                            default -> List.of();
                        });
                    }
                    case "/mdms-v2/v2/_update/tenant.tenants" -> {
                        tenantName=((Map<?,?>)((Map<?,?>)request.get("Mdms")).get("data")).get("name").toString();response=Map.of("ok",true);
                    }
                    case "/localization/messages/v1/_upsert" -> {
                        Map<?,?> label=(Map<?,?>)((List<?>)request.get("messages")).get(0);
                        labels.put(label.get("locale").toString(),label.get("message").toString());response=Map.of("ok",true);
                    }
                    case "/localization/messages/cache-bust" -> {cacheBusted=true;response=null;}
                    default -> {response=Map.of("error","unexpected path");status=404;}
                }
            }
            exchange.getResponseHeaders().add("Content-Type","application/json");
            if(response==null)exchange.sendResponseHeaders(200,-1);
            else {byte[] bytes=mapper.writeValueAsBytes(response);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);}
            exchange.close();
        });server.start();
        String host="http://127.0.0.1:"+server.getAddress().getPort();
        var env=new MockEnvironment().withProperty("egov.user.host",host).withProperty("egov.mdms.host",host).withProperty("egov.localization.host",host).withProperty("egov.hrms.host",host).withProperty("egov.boundary.host",host).withProperty("egov.gateway.host",host)
                .withProperty("pgr.onboarding.identity-bff.url",host).withProperty("pgr.onboarding.identity-bff.token","onboarding-token")
                .withProperty("pgr.onboarding.provisioner.username","test").withProperty("pgr.onboarding.provisioner.password","test")
                .withProperty("pgr.onboarding.provisioner.tenant-id","platform");
        client=new OnboardingProvisionerClient(new RestTemplate(),mapper,env);
        var steps=new OnboardingSteps(client,new PlatformBaseline(mapper),mapper);
        gateway=new WorkspaceGateway(new RestTemplate(),env,client,steps,mapper,new WorkspaceWriteClient(new RestTemplate(),env));
    }
    @After public void stop(){if(server!=null)server.stop(0);}

    @Test public void nameCheckUsesDedicatedBearerAndExactBatchWire() {
        gateway.requireNameAvailable("new name");
        assertEquals(1,requests.size());
        assertEquals("Bearer onboarding-token",requests.get(0).get("authorization"));
        assertEquals(Map.of("identifiers",List.of(Map.of("type","ORGANIZATION_NAME","value","new name"))),requests.get(0).get("body"));
    }
    @Test public void occupiedLegacyNameAndUnreadableResultsFailClosed() {
        nameCheck=mapper.valueToTree(Map.of("results",List.of(Map.of("type","ORGANIZATION_NAME","value","new name","available",false))));
        assertEquals("WORKSPACE_NAME_TAKEN",assertThrows(ResponseStatusException.class,()->gateway.requireNameAvailable("new name")).getReason());
        for(Object malformed:List.of(Map.of(),Map.of("results",List.of()),Map.of("results",List.of(Map.of("type","ORGANIZATION_NAME","value","other","available",true))),
                Map.of("results",List.of(Map.of("type","ORGANIZATION_NAME","value","new name","available","true"))))) {
            nameCheck=mapper.valueToTree(malformed);
            assertEquals("WORKSPACE_DEPENDENCY_UNAVAILABLE",assertThrows(ResponseStatusException.class,()->gateway.requireNameAvailable("new name")).getReason());
        }
        nameStatus=503;
        assertTrue(assertThrows(OnboardingFailure.class,()->gateway.requireNameAvailable("new name")).isRetryable());
    }
    @Test public void publisherWritesAuthoritativeMdmsEveryLocaleAndAcceptsEmptyCacheBust() {
        var repository=mock(WorkspaceRepository.class);
        when(repository.find("example",true)).thenReturn(Optional.of(Map.of("tenantId","example")));
        var rename=new LinkedHashMap<String,Object>(Map.of("id",UUID.randomUUID().toString(),"tenantId","example","name","New Name","version",2L,
                "languages",gateway.languages("example"),"progress",new ArrayList<String>(),"status","PENDING"));
        when(repository.rename("example",1L)).thenReturn(Optional.of(rename));
        new WorkspaceRenamePublisher(repository,gateway).publish(Map.of("tenantId","example","version",1L,"RequestInfo",Map.of("authToken","caller-token")));
        assertEquals("New Name",tenantName);assertEquals(Map.of("en_IN","New Name","hi_IN","New Name"),labels);assertTrue(cacheBusted);
        verify(repository).finishRename(rename);verify(repository,never()).retryRename(any(),any());
        for(Map<String,Object> request:requests) {
            assertFalse(request.get("path").toString().contains("identity"));
            String expected=request.get("path").toString().endsWith("/_search")?"internal-token":"caller-token";
            assertEquals(expected,((Map<?,?>)((Map<?,?>)request.get("body")).get("RequestInfo")).get("authToken"));
            if(request.get("path").equals("/localization/messages/v1/_upsert")) {
                Map<?,?> body=(Map<?,?>)request.get("body");assertEquals("example",body.get("tenantId"));
                assertEquals("TENANT_TENANTS_EXAMPLE",((Map<?,?>)((List<?>)body.get("messages")).get(0)).get("code"));
            }
        }
    }
    @Test public void workspaceSearchSuppliesPaginationToStrictHrms() throws Exception {
        // The fixture first proves the previous URL fails without offset.
        assertThrows(OnboardingFailure.class,()->client.read("hrms","/egov-hrms/employees/_search?tenantId=example&limit=1000",Map.of()));
        workspaceSearch().andExpect(status().isOk()).andExpect(jsonPath("$.Probes.EMPLOYEES").value(true));
        Map<String,Object> hrms=requests.stream().filter(r->r.get("path").equals("/egov-hrms/employees/_search")).reduce((a,b)->b).orElseThrow();
        var query=UriComponentsBuilder.fromUriString("http://hrms/?"+hrms.get("query")).build().getQueryParams();
        assertEquals("example",query.getFirst("tenantId"));assertEquals("0",query.getFirst("offset"));assertEquals("1000",query.getFirst("limit"));
    }
    @Test public void paginatedProbeStillExcludesFounderAndInactiveEmployees() throws Exception {
        employees=List.of(Map.of("code","FOUNDER_1"),Map.of("code","INACTIVE_EMP","isActive",false),
                Map.of("code","DISABLED_USER","user",Map.of("active",false)));
        workspaceSearch().andExpect(status().isOk()).andExpect(jsonPath("$.Probes.EMPLOYEES").value(false));
    }
    @Test public void hrmsFailureDegradesOnlyTheEmployeesProbeOnSearch() throws Exception {
        hrmsStatus=503;
        workspaceSearch().andExpect(status().isOk()).andExpect(jsonPath("$.Probes.EMPLOYEES").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.Probes.GEOGRAPHY").value(false));
    }
    private org.springframework.test.web.servlet.ResultActions workspaceSearch() throws Exception {
        var repository=mock(WorkspaceRepository.class);
        when(repository.find("example",false)).thenReturn(Optional.of(Map.of("tenantId","example","legacy",false,"status","NOT_STARTED","version",1L)));
        var mvc=MockMvcBuilders.standaloneSetup(new WorkspaceApiController(new WorkspaceService(repository,gateway,new OnboardingIdentifierService()),new WorkspaceRenamePublisher(repository,gateway))).build();
        return mvc.perform(post("/v2/onboarding/workspaces/_search").contentType("application/json")
                .content("{\"tenantId\":\"example\",\"RequestInfo\":{\"authToken\":\"normal-token\"}}"));
    }

}
