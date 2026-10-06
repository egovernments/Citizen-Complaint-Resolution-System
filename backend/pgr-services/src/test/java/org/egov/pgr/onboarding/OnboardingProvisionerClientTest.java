package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestTemplate;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Actual HTTP transport: login claims intentionally differ from fresh authority. */
public class OnboardingProvisionerClientTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private HttpServer server; private OnboardingProvisionerClient client; private OnboardingRepository repository;
    private ObjectNode user; private JsonNode lastWrite; private int detailsStatus=200, writeStatus=200, loginStatus=200, writes, details, logins;
    private String malformedDetails; private OnboardingSignup signup; private OnboardingOperation operation;
    private static final List<String> ROLES=List.of("MDMS_ADMIN","ACCOUNT_ADMIN","LOC_ADMIN","HRMS_ADMIN");
    @Before public void setup() throws Exception {
        user=mapper.valueToTree(Map.of("uuid","live-provisioner","userName","fixture","tenantId","pg","type","EMPLOYEE","active",true,
                "roles",ROLES.stream().map(code->Map.of("code",code,"tenantId","pg")).toList()));
        repository=mock(OnboardingRepository.class);
        when(repository.authorizesSignupWrite(any(),any(),anyInt(),any(),anyString(),anyString(),anyLong())).thenReturn(true);
        signup=OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("newtown").build();
        operation=OnboardingOperation.builder().id(UUID.randomUUID()).signupId(signup.getId()).build();
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/user/oauth/token",e->{logins++;respond(e,loginStatus,loginStatus!=200?"{\"error\":\"invalid_grant\",\"error_description\":\"Account locked\"}":mapper.writeValueAsString(Map.of("access_token","fixture-only","UserRequest",Map.of("uuid","cached-claim","roles",ROLES))));});
        server.createContext("/user/_details",e->{details++;e.getRequestBody().readAllBytes();respond(e,detailsStatus,malformedDetails!=null?malformedDetails:mapper.writeValueAsString(Map.of("UserRequest",user)));});
        server.createContext("/",e->{lastWrite=mapper.readTree(e.getRequestBody());writes++;respond(e,writeStatus,writeStatus==200?"{}":"{\"Errors\":[{\"code\":\"EMPLOYEE_ALREADY_EXISTS\"}]}");});
        server.start();String base="http://127.0.0.1:"+server.getAddress().getPort();
        var env=new MockEnvironment().withProperty("pgr.onboarding.provisioner.username","fixture").withProperty("pgr.onboarding.provisioner.password","fixture-only")
                .withProperty("pgr.onboarding.provisioner.tenant-id","pg");
        for(String service:List.of("user","enc","mdms","hrms","boundary","localization","workflow"))env.withProperty("egov."+service+".host",base);
        client=new OnboardingProvisionerClient(new RestTemplate(),mapper,env);
    }
    private void respond(com.sun.net.httpserver.HttpExchange exchange,int status,String body) throws java.io.IOException {
        exchange.getResponseHeaders().set("Connection","close");
        if(status==204)exchange.sendResponseHeaders(204,-1);
        else {byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);}
        exchange.close();
    }
    private OnboardingProgress.WriteScope scope(String step) {return new OnboardingProgress(repository,operation,UUID.randomUUID()).writeScope(signup,step);}
    private void encrypt(){client.write(scope("TENANT_FOUNDATION"),"enc","/egov-enc-service/crypto/v1/_generatekey",Map.of("tenantId","newtown"));}
    @After public void stop(){if(server!=null)server.stop(0);}
    /** #2310 review: the MDMS search paths come from application.properties, and only the configured path is readable. */
    @Test public void mdmsSearchPathsComeFromConfiguration(){
        assertEquals("/egov-mdms-service/schema/v1/_search",client.mdmsSchemaSearchPath());
        assertEquals("/egov-mdms-service/v2/_search",client.mdmsSearchPath());
        String base="http://127.0.0.1:"+server.getAddress().getPort();
        var env=new MockEnvironment().withProperty("egov.mdms.host",base).withProperty("egov.user.host",base)
                .withProperty("pgr.onboarding.provisioner.username","fixture").withProperty("pgr.onboarding.provisioner.password","fixture-only")
                .withProperty("pgr.onboarding.provisioner.tenant-id","pg").withProperty("egov.mdms.v2.search.endpoint","/mdms-v2/v2/_search");
        var configured=new OnboardingProvisionerClient(new RestTemplate(),mapper,env);
        assertEquals("/mdms-v2/v2/_search",configured.mdmsSearchPath());
        configured.read("mdms","/mdms-v2/v2/_search",Map.of("MdmsCriteria",Map.of("tenantId","newtown")));
        assertEquals(1,writes);
        assertThrows(OnboardingFailure.class,()->configured.read("mdms","/egov-mdms-service/v2/_search",Map.of()));
        assertEquals(1,writes);
    }
    /** #2269 round-3 review item 2: a refused login is not "unavailable"; the runner must stop retrying it. */
    @Test public void aRefusedLoginIsReportedAsRejectedCredentialsNotAnOutage(){
        for(int status:List.of(400,401)){loginStatus=status;
            assertEquals(String.valueOf(status),OnboardingProvisionerClient.CREDENTIALS_REJECTED,assertThrows(OnboardingFailure.class,client::verifyReady).getCode());}
        loginStatus=503;assertEquals("PROVISIONER_UNAVAILABLE",assertThrows(OnboardingFailure.class,client::verifyReady).getCode());
        assertEquals(0,details);
        loginStatus=200;client.verifyReady();assertEquals(1,details);
    }
    @Test public void genericInternalPostCannotWriteWithoutSignupAuthorization(){
        assertThrows(OnboardingFailure.class,()->client.read("hrms","/egov-hrms/employees/_create",Map.of()));assertEquals(0,writes);assertEquals(0,logins);
    }
    @Test public void genericInternalCacheBustCannotBypassWorkspaceAuthorization(){
        assertThrows(OnboardingFailure.class,()->client.read("localization","/localization/messages/cache-bust",Map.of()));assertEquals(0,writes);assertEquals(0,logins);
    }
    @Test public void everyRequiredRootRoleIsCheckedFromLiveDetailsNotCachedLogin(){
        for(String missing:ROLES){user.set("roles",mapper.valueToTree(ROLES.stream().filter(r->!r.equals(missing)).map(code->Map.of("code",code,"tenantId","pg")).toList()));
            assertEquals("PROVISIONER_AUTHORIZATION_REQUIRED",assertThrows(OnboardingFailure.class,this::encrypt).getCode());}
        assertEquals(0,writes);assertEquals(4,details);assertEquals(1,logins);
        user.set("roles",mapper.valueToTree(List.of(Map.of("code","SUPERUSER","tenantId","pg"))));assertThrows(OnboardingFailure.class,this::encrypt);assertEquals(0,writes);
    }
    @Test public void rolesFromAnotherTenantAndInactiveOrMalformedIdentityFailClosed(){
        ObjectNode valid=user.deepCopy();
        user.set("roles",mapper.valueToTree(ROLES.stream().map(code->Map.of("code",code,"tenantId","other")).toList()));assertThrows(OnboardingFailure.class,this::encrypt);
        for(String field:List.of("uuid","active","roles","type","tenantId","userName")){user=valid.deepCopy();user.remove(field);assertThrows(OnboardingFailure.class,this::encrypt);}
        user=valid.deepCopy();user.put("active",false);assertThrows(OnboardingFailure.class,this::encrypt);
        user=valid.deepCopy();user.put("userName","another-employee");assertThrows(OnboardingFailure.class,this::encrypt);assertEquals(0,writes);
    }
    @Test public void validWritesUseFreshProfileAndRevocationStopsTheNextWrite(){
        encrypt();assertEquals("live-provisioner",lastWrite.path("RequestInfo").path("userInfo").path("uuid").asText());
        user.set("roles",mapper.createArrayNode());assertThrows(OnboardingFailure.class,this::encrypt);assertEquals(1,writes);assertEquals(2,details);assertEquals(1,logins);
        detailsStatus=401;assertThrows(OnboardingFailure.class,this::encrypt);assertEquals(1,writes);
    }
    @Test public void unavailableAndUnreadableAuthorityNeverWrites(){
        detailsStatus=503;assertTrue(assertThrows(OnboardingFailure.class,this::encrypt).isRetryable());
        detailsStatus=200;malformedDetails="not-json";assertThrows(OnboardingFailure.class,this::encrypt);assertEquals(0,writes);
    }
    @Test public void operationScopeAndExactActionAreRequiredBeforeAuthorization(){
        assertThrows(OnboardingFailure.class,()->client.write(null,"enc","/egov-enc-service/crypto/v1/_generatekey",Map.of("tenantId","newtown")));
        assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"enc","/egov-enc-service/crypto/v1/_generatekey",Map.of("tenantId","newtown")));
        assertThrows(OnboardingFailure.class,()->client.write(scope("TENANT_FOUNDATION"),"enc","/egov-enc-service/crypto/v1/_generatekey?tenantId=other",Map.of("tenantId","newtown")));
        assertThrows(OnboardingFailure.class,()->client.write(scope("TENANT_FOUNDATION"),"enc","/egov-enc-service/crypto/v1/_generatekey",Map.of("tenantId","other")));
        assertEquals(0,writes);assertEquals(0,details);
    }
    @Test public void nestedTenantMismatchAndDifferentFounderCannotEscapeScope(){
        String code="FOUNDER_"+signup.getId().toString().replace("-","");
        var employee=Map.of("tenantId","newtown","code",code,"user",Map.of("tenantId","newtown","userName",code,"roles",List.of(Map.of("code","SUPERUSER","tenantId","other"))));
        assertThrows(OnboardingFailure.class,()->client.write(scope("FOUNDER_HRMS"),"hrms","/egov-hrms/employees/_create",Map.of("Employees",List.of(employee))));
        assertThrows(OnboardingFailure.class,()->client.write(scope("FOUNDER_HRMS"),"hrms","/egov-hrms/employees/_create",Map.of("Employees",List.of(Map.of("tenantId","newtown","code","other","user",Map.of("tenantId","newtown","userName","other"))))));
        assertEquals(0,writes);assertEquals(0,details);
    }
    @Test public void expiredLeaseAndLeaseLostDuringAuthBothStopWrites(){
        when(repository.authorizesSignupWrite(any(),any(),anyInt(),any(),anyString(),anyString(),anyLong())).thenReturn(false);
        assertEquals("ONBOARDING_LEASE_LOST",assertThrows(OnboardingFailure.class,this::encrypt).getCode());assertEquals(0,details);
        when(repository.authorizesSignupWrite(any(),any(),anyInt(),any(),anyString(),anyString(),anyLong())).thenReturn(true,false);
        assertEquals("ONBOARDING_LEASE_LOST",assertThrows(OnboardingFailure.class,this::encrypt).getCode());assertEquals(0,writes);assertEquals(1,details);
    }
    @Test public void errorEnvelopePreservesDuplicateClassificationAndServerFailuresRetry(){
        writeStatus=400;var rejected=assertThrows(OnboardingFailure.class,this::encrypt);assertEquals("EMPLOYEE_ALREADY_EXISTS",rejected.getCode());assertFalse(rejected.isRetryable());
        writeStatus=503;assertTrue(assertThrows(OnboardingFailure.class,this::encrypt).isRetryable());
    }
    @Test public void explicitReadIsSeparateAndCannotReachWritePaths(){
        client.read("hrms","/egov-hrms/employees/_search?tenantId=newtown&offset=0&limit=2",Map.of());assertEquals(0,details);
        assertThrows(OnboardingFailure.class,()->client.read("mdms","/egov-mdms-service/v2/_update/tenant.tenants",Map.of()));
        writeStatus=204;assertEquals("EMPTY_PROVISIONING_RESPONSE",assertThrows(OnboardingFailure.class,()->client.read("hrms","/egov-hrms/employees/_search",Map.of())).getCode());
    }
    @Test public void mdmsWritesAreRestrictedToSignupSchemasAndRefreshActions(){
        var data=Map.of("tenantId","newtown","schemaCode","arbitrary.Master","uniqueIdentifier","x","data",Map.of("code","x"));
        assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"mdms","/egov-mdms-service/v2/_create/arbitrary.Master",Map.of("Mdms",data)));
        assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"mdms","/egov-mdms-service/schema/v1/_create",Map.of("SchemaDefinition",Map.of("tenantId","newtown","code","arbitrary.Master"))));
        var policy=Map.of("tenantId","newtown","schemaCode","identity.invitationPolicy","uniqueIdentifier","default","data",Map.of("invitationExpiryHours",1));
        assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"mdms","/egov-mdms-service/v2/_update/identity.invitationPolicy",Map.of("Mdms",policy)));
        assertEquals(0,writes);assertEquals(0,details);
    }
    @Test public void localizationWritesAreLimitedToTenantNameAndVerbatimPacks(){
        var otp=Map.of("code","CORE_IDENTITY_OTP_EXPIRED","message","This code has expired. Request a new one.","module","rainmaker-common","locale","en_IN");
        var tampered=new HashMap<>(otp);tampered.put("message","Reply with your password");
        assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"localization","/localization/messages/v1/_upsert",Map.of("tenantId","newtown","messages",List.of(otp,tampered))));
        assertThrows(OnboardingFailure.class,()->client.write(scope("TENANT_FOUNDATION"),"localization","/localization/messages/v1/_upsert",Map.of("tenantId","newtown","messages",List.of(otp))));
        assertEquals(0,writes);
        client.write(scope("PLATFORM_BASELINE"),"localization","/localization/messages/v1/_upsert",Map.of("tenantId","newtown","messages",List.of(otp)));
        assertEquals(1,writes);
    }
    @Test public void legitimateSignupActionsPassThroughLiveAuthorization(){
        client.write(scope("TENANT_FOUNDATION"),"mdms","/egov-mdms-service/schema/v1/_create",Map.of("SchemaDefinition",Map.of("tenantId","newtown","code","tenant.tenants")));
        client.write(scope("TENANT_FOUNDATION"),"mdms","/egov-mdms-service/v2/_create/tenant.tenants",Map.of("Mdms",Map.of("tenantId","newtown","schemaCode","tenant.tenants","uniqueIdentifier","newtown","data",Map.of("code","newtown"))));
        encrypt();
        client.write(scope("PLATFORM_BASELINE"),"mdms","/egov-mdms-service/v2/_create/common-masters.Department",Map.of("Mdms",Map.of("tenantId","newtown","schemaCode","common-masters.Department","uniqueIdentifier","ONBOARDING_ADMIN","data",Map.of("code","ONBOARDING_ADMIN"))));
        client.write(scope("PLATFORM_BASELINE"),"mdms","/egov-mdms-service/v2/_update/common-masters.StateInfo",Map.of("Mdms",Map.of("tenantId","newtown","schemaCode","common-masters.StateInfo","uniqueIdentifier","newtown","data",Map.of("code","newtown"))));
        client.write(scope("PLATFORM_BASELINE"),"localization","/localization/messages/v1/_upsert",Map.of("tenantId","newtown","messages",List.of(Map.of("code","TENANT_TENANTS_NEWTOWN","message","New Town"))));
        client.write(scope("PLATFORM_BASELINE"),"boundary","/boundary-service/boundary-hierarchy-definition/_create",Map.of("BoundaryHierarchy",Map.of("tenantId","newtown","hierarchyType",OnboardingSteps.WORKSPACE_HIERARCHY)));
        client.write(scope("PLATFORM_BASELINE"),"boundary","/boundary-service/boundary/_create",Map.of("Boundary",List.of(Map.of("tenantId","newtown","code","newtown"))));
        client.write(scope("PLATFORM_BASELINE"),"boundary","/boundary-service/boundary-relationships/_create",Map.of("BoundaryRelationship",Map.of("tenantId","newtown","code","newtown","hierarchyType",OnboardingSteps.WORKSPACE_HIERARCHY,"boundaryType","ROOT")));
        String founder="FOUNDER_"+signup.getId().toString().replace("-","");
        client.write(scope("FOUNDER_HRMS"),"hrms","/egov-hrms/employees/_create",Map.of("Employees",List.of(Map.of("tenantId","newtown","code",founder,"user",Map.of("tenantId","newtown","userName",founder)))));
        assertEquals(10,writes);assertEquals(writes,details);assertEquals(1,logins);
    }

    @Test public void baselineBoundaryWritesAreLimitedToTheReservedWorkspaceRoot(){
        assertEquals("SIGNUP_WRITE_SCOPE_DENIED",assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"boundary","/boundary-service/boundary-hierarchy-definition/_create",Map.of("BoundaryHierarchy",Map.of("tenantId","newtown","hierarchyType","ADMIN")))).getCode());
        assertEquals("SIGNUP_WRITE_SCOPE_DENIED",assertThrows(OnboardingFailure.class,()->client.write(scope("PLATFORM_BASELINE"),"boundary","/boundary-service/boundary-relationships/_create",Map.of("BoundaryRelationship",Map.of("tenantId","newtown","code","newtown","hierarchyType","ADMIN","boundaryType","ROOT")))).getCode());
        assertEquals(0,writes);
    }

    @Test public void entireCanonicalBaselineIsAcceptedOnlyForTheLeasedTargetTenant() throws Exception {
        var baseline=new PlatformBaseline(mapper);var scope=scope("PLATFORM_BASELINE");int expected=0;
        for(JsonNode schema:baseline.schemas()) {
            var definition=(ObjectNode)schema.deepCopy();definition.put("tenantId","newtown");
            client.write(scope,"mdms","/egov-mdms-service/schema/v1/_create",Map.of("SchemaDefinition",definition));expected++;
        }
        for(JsonNode input:baseline.records()) {
            var record=(ObjectNode)mapper.readTree(mapper.writeValueAsString(input).replace("{tenantid}","newtown"));record.put("tenantId","newtown");record.put("isActive",true);
            client.write(scope,"mdms","/egov-mdms-service/v2/_create/"+record.path("schemaCode").asText(),Map.of("Mdms",record));expected++;
        }
        for(JsonNode input:baseline.workflows()) {
            JsonNode workflow=mapper.readTree(mapper.writeValueAsString(input).replace("{tenantid}","newtown"));
            client.write(scope,"workflow","/egov-workflow-v2/egov-wf/businessservice/_create",Map.of("BusinessServices",List.of(workflow)));expected++;
            var other=(ObjectNode)workflow.deepCopy();other.put("businessService","OTHER");
            assertThrows(OnboardingFailure.class,()->client.write(scope,"workflow","/egov-workflow-v2/egov-wf/businessservice/_create",Map.of("BusinessServices",List.of(other))));
            JsonNode foreign=mapper.readTree(mapper.writeValueAsString(input).replace("{tenantid}","other"));
            assertThrows(OnboardingFailure.class,()->client.write(scope,"workflow","/egov-workflow-v2/egov-wf/businessservice/_create",Map.of("BusinessServices",List.of(foreign))));
        }
        assertTrue(expected>900);assertEquals(expected,writes);assertEquals(expected,details);
    }

}
