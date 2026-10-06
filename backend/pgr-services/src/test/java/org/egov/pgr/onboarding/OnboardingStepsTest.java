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
    private List<Object> workflows=new ArrayList<>();
    private OnboardingFailure createFailure;
    @Before @SuppressWarnings("unchecked") public void setup() throws Exception {
        client=mock(OnboardingProvisionerClient.class);steps=new OnboardingSteps(client,new PlatformBaseline(mapper),mapper);
        signup=OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("newtown").accountName("New Town").accountCode("NEW-TOWN").urlSlug("newtown").countryCode("IN").timeZone("Asia/Kolkata").financialYearPolicy("APRIL_MARCH")
                .languages(List.of("en","hi")).founderName("Founder").founderEmail("unverified@example.test").founderEmailVerified(false).createdAt(1L)
                .tenantMetadata(Map.of("tenantAdmin",Map.of("mobileNumber","+91 98765-43210","countryCode","+91"))).build();
        op=OnboardingOperation.builder().id(UUID.randomUUID()).signupId(signup.getId()).build();
        OnboardingRepository repository=mock(OnboardingRepository.class);when(repository.checkpoint(any(),any(),anyLong())).thenReturn(true);
        progress=new OnboardingProgress(repository,op,UUID.randomUUID());
        rows.put("in|common-masters.MobileNumberValidation|+91",mapper.valueToTree(Map.of("isActive",true,"data",Map.of("countryCode","+91","mobileNumberRegex","^[6-9][0-9]{9}$","default",true))));
        org.mockito.stubbing.Answer<JsonNode> api=call->{
            int offset=call.getMethod().getName().equals("write")?1:0;
            String service=call.getArgument(offset),path=call.getArgument(offset+1);Map<String,Object> body=call.getArgument(offset+2);
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
                if(path.contains("_search")) { assertTrue("stock HRMS requires explicit offset",path.contains("&offset=0")); assertTrue("founder uniqueness search needs two results",path.contains("&limit=2")); return mapper.valueToTree(Map.of("Employees",employees)); }
                assertTrue("platform prerequisites before HRMS",rows.containsKey("newtown|common-masters.Department|ONBOARDING_ADMIN"));
                if(createFailure!=null)throw createFailure;
                Map<String,Object> employee=((List<Map<String,Object>>)body.get("Employees")).get(0);createdUser=(Map<String,Object>)employee.get("user");
                createdUser=new LinkedHashMap<>(createdUser);createdUser.put("uuid","founder-uuid");employees.add(mapper.valueToTree(Map.of("user",createdUser)));writes.add("hrms:create");return mapper.valueToTree(Map.of("Employees",employees));
            }
            writes.add(service+":"+path);
            if(service.equals("workflow")) {
                if(path.contains("_search"))return mapper.valueToTree(Map.of("BusinessServices",workflows));
                workflows.addAll((List<Object>)body.get("BusinessServices"));return mapper.createObjectNode();
            }
            if(service.equals("boundary")&&path.contains("_search"))return mapper.valueToTree(Map.of("BoundaryHierarchy",List.of(Map.of("hierarchyType","WORKSPACE")),"Boundary",List.of(Map.of("code","newtown")),"TenantBoundary",List.of(Map.of("tenantId","newtown","hierarchyType","WORKSPACE","boundary",List.of(Map.of("code","newtown","boundaryType","ROOT"))))));
            return mapper.createObjectNode();
        };
        when(client.read(anyString(),anyString(),anyMap())).thenAnswer(api);
        when(client.write(any(),anyString(),anyString(),anyMap())).thenAnswer(api);
    }
    /** #2269 round-3 item 1: a signup queued before submit refused reserved tenant ids fails terminally and writes nothing. */
    @Test public void aQueuedSignupForAPlatformTenantFailsTerminallyBeforeAnyWrite() throws Exception {
        var configured=new OnboardingSteps(client,new PlatformBaseline(mapper),mapper,new OnboardingIdentifierService(List.of("ke")));
        for(String tenant:List.of("default","ke")){
            signup.setRequestedTenantId(tenant);
            for(String step:OnboardingRunner.STEPS){
                OnboardingFailure failure=assertThrows(tenant+" "+step,OnboardingFailure.class,()->configured.perform(step,signup,op,progress));
                assertEquals("ONBOARDING_IDENTIFIER_TAKEN",failure.getCode());assertFalse(failure.isRetryable());
            }
        }
        assertEquals(List.of(),writes);
        verify(client,never()).write(any(),anyString(),anyString(),anyMap());
        verify(client,never()).read(anyString(),anyString(),anyMap());
        verify(client,never()).identity(anyString(),anyMap());
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
        // Only en_IN carries the whole rainmaker-common pack, so only en_IN gets the tenant-name key.
        verify(client,times(1)).write(any(),eq("localization"),eq("/localization/messages/v1/_upsert"),argThat(b->b.toString().contains("New Town")));
        verify(client,never()).read(eq("mdms"),anyString(),argThat(b->!b.toString().contains("tenantId=newtown")));
        var order=inOrder(client);order.verify(client).read(eq("hrms"),contains("_search"),anyMap());order.verify(client).write(any(),eq("hrms"),contains("_create"),anyMap());
        steps.perform("FOUNDER_HRMS",signup,op,progress);verify(client,times(1)).write(any(),eq("hrms"),contains("_create"),anyMap());
    }
    @Test public void baselineCreatesTenantPgrWorkflowOnceWithSeededRoles(){
        prerequisites();assertEquals(1,workflows.size());JsonNode bs=mapper.valueToTree(workflows.get(0));
        assertEquals("PGR",bs.path("businessService").asText());assertEquals("newtown",bs.path("tenantId").asText());assertFalse(bs.toString().contains("{tenantid}"));
        verify(client).read(eq("workflow"),eq("/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=newtown&businessServices=PGR"),anyMap());
        for(String state:List.of("PENDINGFORASSIGNMENT","PENDINGFORREASSIGNMENT","PENDINGATLME","RESOLVED","REJECTED","CLOSEDAFTERRESOLUTION","CLOSEDAFTERREJECTION"))
            assertTrue(state,bs.path("states").findValuesAsText("state").contains(state));
        for(JsonNode role:bs.findValues("roles"))for(JsonNode code:role)
            assertTrue("seeded role "+code,rows.containsKey("newtown|ACCESSCONTROL-ROLES.roles|"+code.asText()));
        op.getRecordProgress().clear();prerequisites();assertEquals(1,workflows.size());
        verify(client,times(1)).write(any(),eq("workflow"),eq("/egov-workflow-v2/egov-wf/businessservice/_create"),anyMap());
    }
    @Test public void baselineSeedsTenantReadMastersOnlyAtTheNewTenant(){
        rows.clear();prerequisites();
        assertEquals("newtown",rows.get("newtown|tenant.citymodule|PGR").path("data").path("tenants").path(0).path("code").asText());
        assertTrue(rows.containsKey("newtown|tenant.citymodule|Dashboard"));
        assertTrue(rows.get("newtown|RAINMAKER-PGR.InboxVisibilityConfig|INBOX_VISIBILITY").path("data").path("enabled").asBoolean());
        assertTrue(rows.get("newtown|RAINMAKER-PGR.UIConstants|DEFAULT").path("data").path("REOPENSLA").asLong()>0);
        // The Geography step records the operational hierarchy; the baseline must not pre-empt it (#2260).
        assertTrue(schemas.contains("CMS-BOUNDARY.HierarchySchema"));
        assertTrue(rows.keySet().stream().noneMatch(key->key.contains("|CMS-BOUNDARY.HierarchySchema|")));
        for(String key:List.of("RAINMAKER-PGR.MapConfig|DEFAULT","common-masters.ThemeConfig|themeconfig","common-masters.uiHomePage|all-services","RAINMAKER-PGR.RejectionReasons|DUPLICATE"))
            assertTrue(key,rows.containsKey("newtown|"+key));
        assertTrue(schemas.contains("RAINMAKER-PGR.EscalationConfig"));
        assertEquals("Asia/Kolkata",rows.get("newtown|dss.DashboardConfig|default").path("data").path("timeZone").asText());
        JsonNode tenantRecord=rows.get("newtown|tenant.tenants|newtown").path("data");
        assertEquals("Asia/Kolkata",tenantRecord.path("timeZone").asText());assertEquals("APRIL_MARCH",tenantRecord.path("financialYearPolicy").asText());
        assertEquals("NEW-TOWN-PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_ID]",rows.get("newtown|common-masters.IdFormat|pgr.servicerequestid").path("data").path("format").asText());
        assertTrue(rows.keySet().stream().allMatch(key->key.startsWith("newtown|")));
    }
    @Test public void founderRootLivesInTheReservedHierarchyNotAdmin(){
        prerequisites();steps.perform("FOUNDER_HRMS",signup,op,progress);
        verify(client).read(eq("boundary"),eq("/boundary-service/boundary-hierarchy-definition/_search"),argThat(b->b.toString().contains("hierarchyType=WORKSPACE")));
        verify(client).read(eq("boundary"),contains("boundary-relationships/_search?tenantId=newtown&hierarchyType=WORKSPACE"),anyMap());
        verify(client,never()).read(eq("boundary"),anyString(),argThat(b->b.toString().contains("ADMIN")));
        verify(client).write(any(),eq("hrms"),contains("_create"),argThat(b->{
            JsonNode j=mapper.valueToTree(b).path("Employees").path(0).path("jurisdictions").path(0);
            return "WORKSPACE".equals(j.path("hierarchy").asText())&&"ROOT".equals(j.path("boundaryType").asText())&&"newtown".equals(j.path("boundary").asText());}));
    }
    @Test public void foreignTenantCollisionFailsBeforeEncryptionOrFounder(){
        rows.put("newtown|tenant.tenants|newtown",mapper.valueToTree(Map.of("data",Map.of("code","newtown"))));
        OnboardingFailure failure=assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress));assertEquals("TENANT_TAKEN",failure.getCode());assertFalse(failure.isRetryable());
        verify(client,never()).write(any(),eq("enc"),anyString(),anyMap());verify(client,never()).write(any(),eq("hrms"),anyString(),anyMap());
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
        when(client.write(any(),eq("enc"),anyString(),anyMap())).thenThrow(new OnboardingFailure("PROVISIONING_UNAVAILABLE",true));
        assertTrue(assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress)).isRetryable());
        op.setFounderDigitUuid("prior-uuid");assertEquals("FOUNDER_NOT_FOUND",assertThrows(OnboardingFailure.class,()->steps.perform("FOUNDER_HRMS",signup,op,progress)).getCode());
        verify(client,never()).write(any(),eq("hrms"),contains("_create"),anyMap());
    }
    @Test public void asynchronousBoundaryWriteIsNotCheckpointedUntilVisible() throws Exception {
        String path="/boundary-service/boundary-hierarchy-definition/_search";
        when(client.read(eq("boundary"),eq(path),anyMap())).thenReturn(mapper.readTree("{\"BoundaryHierarchy\":[]}"),mapper.readTree("{\"BoundaryHierarchy\":[]}"),mapper.readTree("{\"BoundaryHierarchy\":[{\"hierarchyType\":\"WORKSPACE\"}]}"));
        assertEquals("BOUNDARY_NOT_VISIBLE",assertThrows(OnboardingFailure.class,this::prerequisites).getCode());
        assertEquals("STARTED",op.getRecordProgress().get("boundary-hierarchy"));
        prerequisites();assertEquals("DONE",op.getRecordProgress().get("boundary-hierarchy"));
        verify(client,times(1)).write(any(),eq("boundary"),eq("/boundary-service/boundary-hierarchy-definition/_create"),anyMap());
    }
    @Test public void duplicateSchemaFromUncertainPriorWriteRetriesInsteadOfAbandoningSignup(){
        when(client.write(any(),eq("mdms"),eq("/egov-mdms-service/schema/v1/_create"),anyMap())).thenThrow(new OnboardingFailure("SCHEMA_ALREADY_EXISTS",false));
        OnboardingFailure failure=assertThrows(OnboardingFailure.class,()->steps.perform("TENANT_FOUNDATION",signup,op,progress));
        assertTrue(failure.isRetryable());assertEquals("STARTED",op.getRecordProgress().get("schema:tenant.tenants"));
    }
    @Test public void liveCountryTenantRuleIsNeverReadOrCopied() {
        rows.put("in|common-masters.MobileNumberValidation|+91",mapper.valueToTree(Map.of("isActive",true,"data",Map.of("countryCode","+91","mobileNumberRegex","^[7-9][0-9]{9}$","default",true))));
        rows.put("in|common-masters.MobileNumberValidation|second",mapper.valueToTree(Map.of("isActive",true,"data",Map.of("countryCode","+91","default",true))));
        prerequisites();assertEquals("^[6-9][0-9]{9}$",rows.get("newtown|common-masters.MobileNumberValidation|+91").path("data").path("mobileNumberRegex").asText());
        verify(client,never()).read(eq("mdms"),anyString(),argThat(b->!b.toString().contains("tenantId=newtown")));
    }
    @Test public void unsupportedCountryIsExplicit() {
        signup.setCountryCode("ZZ");OnboardingFailure failure=assertThrows(OnboardingFailure.class,this::prerequisites);
        assertEquals("COUNTRY_NOT_SUPPORTED",failure.getCode());assertFalse(failure.isRetryable());
    }
    @Test public void nullBoundaryResultsCreateValidEntityAndEmptyWrapperDoesNotCountAsRelationship() throws Exception {
        final boolean[] made={false,false,false};
        org.mockito.stubbing.Answer<JsonNode> boundary=call->{
            int offset=call.getMethod().getName().equals("write")?1:0;
            String path=call.getArgument(offset+1);Map<String,Object> body=call.getArgument(offset+2);
            if(path.contains("boundary-hierarchy-definition")) {
                if(path.contains("_create")){assertEquals("WORKSPACE",mapper.valueToTree(body).path("BoundaryHierarchy").path("hierarchyType").asText());made[0]=true;return mapper.createObjectNode();}
                return mapper.readTree(made[0]?"{\"BoundaryHierarchy\":[{\"hierarchyType\":\"WORKSPACE\"}]}":"{\"BoundaryHierarchy\":null}");
            }
            if(path.contains("boundary-relationships")) {
                if(path.contains("_create")){assertEquals("WORKSPACE",mapper.valueToTree(body).path("BoundaryRelationship").path("hierarchyType").asText());made[2]=true;return mapper.createObjectNode();}
                return mapper.readTree(made[2]?"{\"TenantBoundary\":[{\"tenantId\":\"newtown\",\"hierarchyType\":\"WORKSPACE\",\"boundary\":[{\"code\":\"newtown\",\"boundaryType\":\"ROOT\",\"children\":[]}]}]}":"{\"TenantBoundary\":[{\"tenantId\":\"newtown\",\"hierarchyType\":\"WORKSPACE\",\"boundary\":[]}]}");
            }
            if(path.contains("_create")) {JsonNode geometry=mapper.valueToTree(body).path("Boundary").path(0).path("geometry");assertEquals("Point",geometry.path("type").asText());assertEquals(mapper.valueToTree(List.of(0,0)),geometry.path("coordinates"));made[1]=true;return mapper.createObjectNode();}
            return mapper.readTree(made[1]?"{\"Boundary\":[{\"code\":\"newtown\"}]}":"{\"Boundary\":null}");
        };
        when(client.read(eq("boundary"),anyString(),anyMap())).thenAnswer(boundary);
        when(client.write(any(),eq("boundary"),anyString(),anyMap())).thenAnswer(boundary);
        prerequisites();assertTrue(made[0]);assertTrue(made[1]);assertTrue(made[2]);
        assertEquals("DONE",op.getRecordProgress().get("boundary-relationship"));
    }
    // 8c gate 2: stock boundary-service reads relationship criteria from the query
    // string only, and returns hierarchyType as JSON null. An existing relationship
    // must be recognised without re-creating it.
    @Test public void existingRelationshipIsFoundByQueryCriteriaWithNullHierarchyType() throws Exception {
        final boolean[] created={false};
        when(client.read(eq("boundary"),anyString(),anyMap())).thenAnswer(call->{
            String path=call.getArgument(1);
            if(path.contains("boundary-hierarchy-definition")) return mapper.readTree("{\"BoundaryHierarchy\":[{\"hierarchyType\":\"WORKSPACE\"}]}");
            if(path.contains("boundary-relationships")) {
                if(path.contains("_create")){created[0]=true;return mapper.createObjectNode();}
                boolean queryCriteria=path.contains("tenantId=newtown")&&path.contains("hierarchyType=WORKSPACE");
                return mapper.readTree(queryCriteria
                        ?"{\"TenantBoundary\":[{\"tenantId\":\"newtown\",\"hierarchyType\":null,\"boundary\":[{\"code\":\"newtown\",\"boundaryType\":\"ROOT\",\"children\":[]}]}]}"
                        :"{\"TenantBoundary\":[]}");
            }
            return mapper.readTree("{\"Boundary\":[{\"code\":\"newtown\"}]}");
        });
        prerequisites();
        assertFalse(created[0]);
        verify(client,never()).write(any(),eq("boundary"),eq("/boundary-service/boundary-relationships/_create"),anyMap());
        assertEquals("DONE",op.getRecordProgress().get("boundary-relationship"));
    }
    // Countries offered at signup: COUNTRIES in configurator/src/pages/SignupPage.tsx.
    @Test public void everySignupCountryUsesItsSeedRuleWithoutCountryTenants() throws Exception {
        Set<String> seeded=new TreeSet<>();new ObjectMapper().readTree(getClass().getResourceAsStream("/onboarding/platform-baseline-v1.json")).path("countryMobileRules").fieldNames().forEachRemaining(seeded::add);
        assertEquals(new TreeSet<>(List.of("ET","IN","KE","MZ")),seeded);
        Map<String,List<String>> expected=Map.of("IN",List.of("+91","^[6-9][0-9]{9}$"),"KE",List.of("+254","^[17][0-9]{8}$"),
                "ET",List.of("+251","^9[0-9]{8}$"),"MZ",List.of("+258","^8[2-7][0-9]{7}$"));
        rows.clear();
        for(var country:expected.entrySet()) {
            signup.setCountryCode(country.getKey());op.getRecordProgress().remove("mobile");prerequisites();
            JsonNode rule=rows.get("newtown|common-masters.MobileNumberValidation|"+country.getValue().get(0)).path("data");
            assertEquals(country.getValue().get(1),rule.path("mobileNumberRegex").asText());assertTrue(rule.path("default").asBoolean());
        }
        assertTrue(rows.keySet().stream().allMatch(key->key.startsWith("newtown|")));
        verify(client,never()).read(eq("mdms"),anyString(),argThat(b->!b.toString().contains("tenantId=newtown")));
    }

    @Test public void foreignOrInactiveBoundaryEntriesDoNotProvePrerequisites() {
        for(String field:List.of("BoundaryHierarchy","Boundary","TenantBoundary")) {
            for(String invalid:List.of("foreign","inactive")) {
                op.getRecordProgress().clear();
                Map<String,Object> entry=new LinkedHashMap<>(Map.of("tenantId",invalid.equals("foreign")?"other":"newtown","hierarchyType","WORKSPACE","code","newtown","active",!invalid.equals("inactive"),"boundary",List.of(Map.of("code","newtown","boundaryType","ROOT"))));
                when(client.read(eq("boundary"),contains("_search"),anyMap())).thenAnswer(call->mapper.valueToTree(Map.of(
                        "BoundaryHierarchy",field.equals("BoundaryHierarchy")?List.of(entry):List.of(Map.of("hierarchyType","WORKSPACE")),
                        "Boundary",field.equals("Boundary")?List.of(entry):List.of(Map.of("code","newtown")),
                        "TenantBoundary",field.equals("TenantBoundary")?List.of(entry):List.of(Map.of("boundary",List.of(Map.of("code","newtown","boundaryType","ROOT")))))));
                assertEquals("BOUNDARY_NOT_VISIBLE",assertThrows(OnboardingFailure.class,this::prerequisites).getCode());
            }
        }
    }

    @Test @SuppressWarnings({"unchecked","rawtypes"}) public void baselineSeedsWholeLocalizationPacksBeforeTheTenantNameKey() throws Exception {
        prerequisites();
        var bodies=org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(client,atLeastOnce()).write(any(),eq("localization"),eq("/localization/messages/v1/_upsert"),bodies.capture());
        Map<String,Integer> seeded=new TreeMap<>();int firstName=-1,lastPack=-1;
        for(int i=0;i<bodies.getAllValues().size();i++){
            JsonNode body=mapper.valueToTree(bodies.getAllValues().get(i));
            assertEquals("newtown",body.path("tenantId").asText());assertTrue(body.path("messages").size()<=500);
            for(JsonNode m:body.path("messages")){
                if(m.path("code").asText().equals("TENANT_TENANTS_NEWTOWN")){if(firstName<0)firstName=i;}
                else{lastPack=i;seeded.merge(m.path("locale").asText()+"/"+m.path("module").asText(),1,Integer::sum);}
            }
        }
        assertTrue("packs precede the tenant-name key",lastPack>=0&&firstName>lastPack);
        var baseline=new PlatformBaseline(mapper);Map<String,Integer> expected=new TreeMap<>();
        for(String locale:List.of("en_IN","hi_IN"))baseline.localizationPacks(locale).forEach((module,pack)->expected.put(locale+"/"+module,pack.size()));
        assertEquals(expected,seeded); // signup languages en,hi (+ en_IN always); no fr_FR/pt_BR
        assertTrue(seeded.keySet().containsAll(List.of("en_IN/rainmaker-common","en_IN/rainmaker-pgr","en_IN/rainmaker-hr","en_IN/configurator-ui","hi_IN/configurator-ui")));
    }
    @SuppressWarnings({"unchecked","rawtypes"}) private Map<String,Object> localeOutcome(String country,List<String> languages) {
        signup.setCountryCode(country);signup.setLanguages(languages);op.getRecordProgress().clear();clearInvocations(client);
        prerequisites();
        List<String> stateInfo=new ArrayList<>();
        rows.get("newtown|common-masters.StateInfo|newtown").path("data").path("languages").forEach(l->stateInfo.add(l.path("value").asText()+"="+l.path("label").asText()));
        var bodies=org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(client,atLeastOnce()).write(any(),eq("localization"),eq("/localization/messages/v1/_upsert"),bodies.capture());
        Set<String> packs=new TreeSet<>(),names=new TreeSet<>();
        for(Map body:bodies.getAllValues())for(JsonNode m:mapper.valueToTree(body).path("messages"))
            (m.path("code").asText().startsWith("TENANT_TENANTS_")?names:packs).add(m.path("locale").asText());
        return Map.of("stateInfo",stateInfo,"packs",packs,"names",names);
    }
    /** #2269 item 6: a signup language maps to the locale its pack uses, never language_COUNTRY when a pack exists. */
    @Test public void signupLanguagesMapToPackLocalesAndTheNameKeyOnlyGoesWhereTenantOwnsRainmakerCommon() {
        assertEquals(Map.of("stateInfo",List.of("en_IN=en","hi_IN=hi"),"packs",Set.of("en_IN","hi_IN"),"names",Set.of("en_IN")),localeOutcome("IN",List.of("en","hi")));
        // Kenya: en is en_IN, not en_KE; Swahili has no pack, keeps the country code and is served from default.
        assertEquals(Map.of("stateInfo",List.of("en_IN=en","sw_KE=sw"),"packs",Set.of("en_IN"),"names",Set.of("en_IN")),localeOutcome("KE",List.of("en","sw")));
        // Mozambique: pt is pt_BR (the committed pack), not pt_MZ; en_IN still leads although pt was chosen first.
        assertEquals(Map.of("stateInfo",List.of("en_IN=en","pt_BR=pt"),"packs",Set.of("en_IN","pt_BR"),"names",Set.of("en_IN")),localeOutcome("MZ",List.of("pt","en")));
        // Ethiopia without English: en_IN is still added first; fr_FR gets its configurator pack but no name key.
        assertEquals(Map.of("stateInfo",List.of("en_IN=en","fr_FR=fr","am_ET=am"),"packs",Set.of("en_IN","fr_FR"),"names",Set.of("en_IN")),localeOutcome("ET",List.of("fr","am")));
    }
    @Test public void explicitRegionIsKeptAndNormalized() {
        assertEquals("pt_BR",steps.locale("pt-br","MZ"));assertEquals("en_KE",steps.locale("en-ke","KE"));
        assertEquals("en_IN",steps.locale("en","KE"));assertEquals("sw_KE",steps.locale("sw","ke"));
        assertTrue(steps.seedsTenantNameModule("en_IN"));
        for(String locale:List.of("hi_IN","fr_FR","pt_BR","en_KE","sw_KE"))assertFalse(locale,steps.seedsTenantNameModule(locale));
    }
    @Test public void localizationPacksAreTenantNeutral() throws Exception {
        var forbidden=java.util.regex.Pattern.compile("(^|_)(PG|PB|STATEA|CITYA)(_|$)|^TENANT_TENANTS_|^CS_SELECT_CITY_(?!CHOOSE_CITY$)|^SUN\\d+_|^DDR_",java.util.regex.Pattern.CASE_INSENSITIVE);
        var places=java.util.regex.Pattern.compile("amritsar|jalandhar|ludhiana|chandigarh|mohali|bhatinda|faridkot|punjab|bomet|nairobi|maputo|\\bcity a\\b|\\bstate a\\b",java.util.regex.Pattern.CASE_INSENSITIVE);
        var packs=new org.springframework.core.io.support.PathMatchingResourcePatternResolver().getResources("classpath*:onboarding/l10n/*/*.json");
        assertTrue(packs.length>=4);
        for(var pack:packs){
            Set<String> codes=new HashSet<>();
            for(JsonNode m:mapper.readTree(pack.getInputStream())){
                String code=m.path("code").asText();
                assertFalse(pack.getFilename()+": "+code,forbidden.matcher(code).find()||places.matcher(m.path("message").asText()).find());
                assertTrue("duplicate "+code,codes.add(code));
            }
        }
        assertEquals(7,new PlatformBaseline(mapper).localizationPacks("en_IN").get("rainmaker-common").findValuesAsText("code").stream().filter(c->c.startsWith("CORE_IDENTITY_OTP_")).count());
    }
}
