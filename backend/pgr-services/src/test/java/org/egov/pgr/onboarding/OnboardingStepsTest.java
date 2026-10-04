package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.*;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Production step orchestration against deterministic DIGIT API responses. */
public class OnboardingStepsTest {
    private ObjectMapper mapper=new ObjectMapper(); private OnboardingProvisionerClient client;
    private OnboardingSteps steps; private OnboardingSignup signup; private OnboardingOperation op; private OnboardingProgress progress;
    private Map<String,JsonNode> rows=new LinkedHashMap<>();private Set<String> schemas=new HashSet<>();
    private List<String> writes=new ArrayList<>();private List<JsonNode> employees=new ArrayList<>();private Map<String,Object> createdUser;
    private OnboardingFailure createFailure;
    @Before @SuppressWarnings("unchecked") public void setup() throws Exception {
        client=mock(OnboardingProvisionerClient.class);steps=new OnboardingSteps(client,new PlatformBaseline(mapper),mapper);
        signup=OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("newtown").accountName("New Town").urlSlug("newtown").countryCode("IN")
                .languages(List.of("en","hi")).founderName("Founder").founderEmail("unverified@example.test").founderEmailVerified(false).createdAt(1L)
                .tenantMetadata(Map.of("tenantAdmin",Map.of("mobileNumber","+91 98765-43210","countryCode","+91"))).build();
        op=OnboardingOperation.builder().id(UUID.randomUUID()).signupId(signup.getId()).build();
        OnboardingRepository repository=mock(OnboardingRepository.class);when(repository.checkpoint(any(),any(),anyLong())).thenReturn(true);
        progress=new OnboardingProgress(repository,op,UUID.randomUUID());
        rows.put("in|common-masters.MobileNumberValidation|+91",mapper.valueToTree(Map.of("isActive",true,"data",Map.of("countryCode","+91","mobileNumberRegex","^[6-9][0-9]{9}$","default",true))));
        when(client.post(anyString(),anyString(),anyMap())).thenAnswer(call->{
            String service=call.getArgument(0),path=call.getArgument(1);Map<String,Object> body=call.getArgument(2);
            if(service.equals("mdms")) {
                if(path.contains("schema/v1/_search")) {Map<String,Object> criteria=(Map<String,Object>)body.get("SchemaDefCriteria");String code=((List<String>)criteria.get("codes")).get(0);return mapper.valueToTree(Map.of("SchemaDefinitions",schemas.contains(code)?List.of(Map.of("code",code)):List.of()));}
                if(path.contains("schema/v1/_create")) {String code=(String)((Map<?,?>)body.get("SchemaDefinition")).get("code");schemas.add(code);writes.add("schema:"+code);return mapper.createObjectNode();}
                if(path.contains("/v2/_search")) {
                    Map<String,Object> criteria=(Map<String,Object>)body.get("MdmsCriteria");String prefix=criteria.get("tenantId")+"|"+criteria.get("schemaCode")+"|";
                    List<String> ids=(List<String>)criteria.get("uniqueIdentifiers");
                    return mapper.valueToTree(Map.of("mdms",rows.entrySet().stream().filter(e->e.getKey().startsWith(prefix)&&(ids==null||ids.contains(e.getKey().substring(prefix.length())))).map(Map.Entry::getValue).toList()));
                }
                Map<String,Object> row=(Map<String,Object>)body.get("Mdms");String key=row.get("tenantId")+"|"+row.get("schemaCode")+"|"+row.get("uniqueIdentifier");rows.put(key,mapper.valueToTree(row));writes.add("record:"+row.get("schemaCode"));return mapper.createObjectNode();
            }
            if(service.equals("hrms")) {
                if(path.contains("_search"))return mapper.valueToTree(Map.of("Employees",employees));
                assertTrue("platform prerequisites before HRMS",rows.containsKey("newtown|common-masters.Department|ONBOARDING_ADMIN"));
                if(createFailure!=null)throw createFailure;
                Map<String,Object> employee=((List<Map<String,Object>>)body.get("Employees")).get(0);createdUser=(Map<String,Object>)employee.get("user");
                createdUser=new LinkedHashMap<>(createdUser);createdUser.put("uuid","founder-uuid");employees.add(mapper.valueToTree(Map.of("user",createdUser)));writes.add("hrms:create");return mapper.valueToTree(Map.of("Employees",employees));
            }
            writes.add(service+":"+path);
            if(service.equals("boundary")&&path.contains("_search"))return mapper.valueToTree(Map.of("BoundaryHierarchy",List.of(Map.of("code","root")),"Boundary",List.of(Map.of("code","newtown")),"TenantBoundary",List.of(Map.of("code","newtown"))));
            return mapper.createObjectNode();
        });
    }
    private void prerequisites(){steps.perform("TENANT_FOUNDATION",signup,op,progress);steps.perform("PLATFORM_BASELINE",signup,op,progress);}
    @Test public void completePrerequisitesUseCountryRuleEveryLanguageAndVerifiedFounderPolicy(){
        prerequisites();steps.perform("FOUNDER_HRMS",signup,op,progress);
        assertEquals("founder-uuid",op.getFounderDigitUuid());assertEquals("9876543210",createdUser.get("mobileNumber"));assertEquals("+91",createdUser.get("countryCode"));
        assertFalse(createdUser.containsKey("emailId"));assertFalse(createdUser.containsKey("password"));
        assertTrue(mapper.valueToTree(createdUser.get("roles")).toString().contains("SUPERUSER"));
        assertEquals("New Town",rows.get("newtown|tenant.tenants|newtown").path("data").path("name").asText());
        assertEquals(2,rows.get("newtown|common-masters.StateInfo|newtown").path("data").path("languages").size());
        assertEquals(336,rows.get("newtown|identity.invitationPolicy|default").path("data").path("invitationExpiryHours").asInt());
        verify(client,times(2)).post(eq("localization"),eq("/localization/messages/v1/_upsert"),argThat(b->b.toString().contains("New Town")));
        verify(client).post(eq("mdms"),anyString(),argThat(b->b.toString().contains("tenantId=in")&&b.toString().contains("MobileNumberValidation")));
        var order=inOrder(client);order.verify(client).post(eq("hrms"),contains("_search"),anyMap());order.verify(client).post(eq("hrms"),contains("_create"),anyMap());
        steps.perform("FOUNDER_HRMS",signup,op,progress);verify(client,times(1)).post(eq("hrms"),contains("_create"),anyMap());
    }
    @Test public void foreignTenantCollisionFailsBeforeEncryptionOrFounder(){
        rows.put("newtown|tenant.tenants|newtown",mapper.valueToTree(Map.of("data",Map.of("code","newtown"))));
        OnboardingFailure failure=assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress));assertEquals("TENANT_TAKEN",failure.getCode());assertFalse(failure.isRetryable());
        verify(client,never()).post(eq("enc"),anyString(),anyMap());verify(client,never()).post(eq("hrms"),anyString(),anyMap());
    }
    @Test public void founderValidationIsCorrectableAndDuplicateProjectionIsRetried(){
        prerequisites();createFailure=new OnboardingFailure("INVALID_MOBILE",false);
        OnboardingFailure rejected=assertThrows(OnboardingFailure.class,()->steps.perform("FOUNDER_HRMS",signup,op,progress));assertEquals("TENANT_ADMIN_ACCOUNT_REJECTED",rejected.getCode());assertFalse(rejected.isRetryable());
        createFailure=new OnboardingFailure("EMPLOYEE_ALREADY_EXISTS",false);
        OnboardingFailure uncertain=assertThrows(OnboardingFailure.class,()->steps.perform("FOUNDER_HRMS",signup,op,progress));assertTrue(uncertain.isRetryable());assertNull(op.getFounderDigitUuid());
    }
    @Test public void retryUpdatesOwnedTenantNameAndStateInfoAndIncludesOnlyVerifiedEmail(){
        prerequisites();signup.setAccountName("Corrected Town");signup.setFounderEmailVerified(true);
        op.getRecordProgress().clear();prerequisites();steps.perform("FOUNDER_HRMS",signup,op,progress);
        assertEquals("Corrected Town",rows.get("newtown|tenant.tenants|newtown").path("data").path("name").asText());
        assertEquals("Corrected Town",rows.get("newtown|common-masters.StateInfo|newtown").path("data").path("name").asText());assertEquals("unverified@example.test",createdUser.get("emailId"));
    }
    @Test public void foundationTransportFailureIsRetryableAndMissingFounderNeverReplaced(){
        when(client.post(eq("enc"),anyString(),anyMap())).thenThrow(new OnboardingFailure("PROVISIONING_UNAVAILABLE",true));
        assertTrue(assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress)).isRetryable());
        op.setFounderDigitUuid("prior-uuid");assertEquals("FOUNDER_NOT_FOUND",assertThrows(OnboardingFailure.class,()->steps.perform("FOUNDER_HRMS",signup,op,progress)).getCode());
        verify(client,never()).post(eq("hrms"),contains("_create"),anyMap());
    }
    @Test public void asynchronousBoundaryWriteIsNotCheckpointedUntilVisible() throws Exception {
        String path="/boundary-service/boundary-hierarchy-definition/_search";
        when(client.post(eq("boundary"),eq(path),anyMap())).thenReturn(mapper.readTree("{\"BoundaryHierarchy\":[]}"),mapper.readTree("{\"BoundaryHierarchy\":[]}"),mapper.readTree("{\"BoundaryHierarchy\":[{\"hierarchyType\":\"ADMIN\"}]}"));
        assertEquals("BOUNDARY_NOT_VISIBLE",assertThrows(OnboardingFailure.class,this::prerequisites).getCode());
        assertEquals("STARTED",op.getRecordProgress().get("boundary-hierarchy"));
        prerequisites();assertEquals("DONE",op.getRecordProgress().get("boundary-hierarchy"));
        verify(client,times(1)).post(eq("boundary"),eq("/boundary-service/boundary-hierarchy-definition/_create"),anyMap());
    }
    @Test public void duplicateSchemaFromUncertainPriorWriteRetriesInsteadOfAbandoningSignup(){
        when(client.post(eq("mdms"),eq("/egov-mdms-service/schema/v1/_create"),anyMap())).thenThrow(new OnboardingFailure("SCHEMA_ALREADY_EXISTS",false));
        OnboardingFailure failure=assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress));
        assertTrue(failure.isRetryable());assertEquals("STARTED",op.getRecordProgress().get("schema:tenant.tenants"));
    }
}
