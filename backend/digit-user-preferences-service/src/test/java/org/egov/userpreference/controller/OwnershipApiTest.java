package org.egov.userpreference.controller;

import org.egov.userpreference.support.ApiTestBase;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * A citizen may only read and write their own preference record.
 *
 * <p>Both endpoints key on the {@code userId} in the request body, so without
 * this any citizen who can reach the route could enumerate a tenant's records
 * and overwrite another citizen's notification consent (CWE-639). The Go
 * service had the same hole; these tests pin it closed.
 */
class OwnershipApiTest extends ApiTestBase {

    private static final String OWNER = "11111111-1111-1111-1111-111111111111";
    private static final String VICTIM = "22222222-2222-2222-2222-222222222222";

    private String citizenUpsert(String principal, String bodyUserId) {
        return """
                {
                  "RequestInfo": { "userInfo": { "uuid": "%s", "roles": [ { "code": "CITIZEN" } ] } },
                  "preference": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "en_IN" }
                  }
                }
                """.formatted(principal, bodyUserId);
    }

    private String citizenSearch(String principal, String criteria) {
        return """
                {
                  "RequestInfo": { "userInfo": { "uuid": "%s", "roles": [ { "code": "CITIZEN" } ] } },
                  "criteria": %s
                }
                """.formatted(principal, criteria);
    }

    @Test
    void letsACitizenWriteTheirOwnRecord() throws Exception {
        upsert(citizenUpsert(OWNER, OWNER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].userId").value(OWNER));
    }

    @Test
    void refusesACitizenWritingSomeoneElsesRecord() throws Exception {
        upsert(citizenUpsert(OWNER, VICTIM))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"))
                .andExpect(jsonPath("$.Errors[0].message").value("userId must match the authenticated user"))
                .andExpect(jsonPath("$.responseInfo.status").value("failed"));
    }

    @Test
    void letsACitizenReadTheirOwnRecord() throws Exception {
        upsert(citizenUpsert(OWNER, OWNER)).andExpect(status().isOk());

        search(citizenSearch(OWNER, "{ \"userId\": \"" + OWNER + "\", \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)));
    }

    @Test
    void refusesACitizenReadingSomeoneElsesRecord() throws Exception {
        search(citizenSearch(OWNER, "{ \"userId\": \"" + VICTIM + "\" }"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));
    }

    @Test
    void refusesACitizenEnumeratingTheWholeTenant() throws Exception {
        // The step that turns this from "read one record" into "harvest every
        // citizen's uuid and consent state in the tenant".
        search(citizenSearch(OWNER, "{ \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"))
                .andExpect(jsonPath("$.Errors[0].message")
                        .value("criteria.userId must match the authenticated user"));
    }

    @Test
    void letsAnAdminActWithinItsOwnTenant() throws Exception {
        upsert(citizenUpsert(OWNER, OWNER)).andExpect(status().isOk());

        search(privilegedSearch("SUPERUSER", "pg.citya", "{ \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)));
    }

    @Test
    void letsAStateLevelAdminReachADescendantTenant() throws Exception {
        // Tenant ids are hierarchical, so a role granted at pg covers pg.citya.
        upsert(citizenUpsert(OWNER, OWNER)).andExpect(status().isOk());

        search(privilegedSearch("SUPERUSER", "pg", "{ \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)));
    }

    @Test
    void refusesAnAdminFromAnotherTenant() throws Exception {
        // A pg.cityb admin must not reach a pg.citya record.
        search(privilegedSearch("SUPERUSER", "pg.cityb", "{ \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));

        String crossTenantUpsert = """
                {
                  "RequestInfo": { "userInfo": { "uuid": "admin-uuid",
                                                 "roles": [ { "code": "SUPERUSER", "tenantId": "pg.cityb" } ] } },
                  "preference": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "en_IN" }
                  }
                }
                """.formatted(VICTIM);

        upsert(crossTenantUpsert)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));
    }

    @Test
    void doesNotTreatEmployeeAsPrivilegedByDefault() throws Exception {
        // HRMS forces EMPLOYEE onto every employee it creates, so it must not
        // carry tenant-wide read/write over citizens' consent.
        search(privilegedSearch("EMPLOYEE", "pg.citya", "{ \"tenantId\": \"pg.citya\" }"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));
    }

    @Test
    void refusesACallerIdentifiedOnlyByANumericIdActingOnAnotherRecord() throws Exception {
        // userInfo present but no uuid used to resolve to "service-to-service"
        // and skip the check, even though the enricher could identify the
        // caller well enough to stamp it into createdBy.
        String body = """
                {
                  "RequestInfo": { "userInfo": { "id": 42, "userName": "attacker", "type": "CITIZEN",
                                                 "roles": [ { "code": "CITIZEN", "tenantId": "pg.citya" } ] } },
                  "preference": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "payload": { "preferredLanguage": "en_IN" }
                  }
                }
                """.formatted(VICTIM);

        upsert(body)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));
    }

    @Test
    void refusesAPresentButUnidentifiableCaller() throws Exception {
        // An authenticated caller we cannot name fails closed rather than
        // falling through the service-to-service branch.
        String body = """
                {
                  "RequestInfo": { "userInfo": {} },
                  "preference": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """.formatted(VICTIM);

        upsert(body)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.Errors[0].code").value("NOT_AUTHORIZED"));
    }

    @Test
    void letsACallerIdentifiedByANumericIdActOnItsOwnRecord() throws Exception {
        String body = """
                {
                  "RequestInfo": { "userInfo": { "id": 42, "roles": [ { "code": "CITIZEN" } ] } },
                  "preference": {
                    "userId": "42",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """;

        upsert(body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences[0].auditDetails.createdBy").value("42"));
    }

    private String privilegedSearch(String role, String roleTenant, String criteria) {
        return """
                {
                  "RequestInfo": { "userInfo": { "uuid": "admin-uuid",
                                                 "roles": [ { "code": "%s", "tenantId": "%s" } ] } },
                  "criteria": %s
                }
                """.formatted(role, roleTenant, criteria);
    }

    @Test
    void letsNovuBridgeThroughOnItsEmptyRequestInfo() throws Exception {
        // PreferenceServiceClient posts `"requestInfo": {}` with no principal
        // for both the consent gate and the configurator listing. No principal
        // means service-to-service, which the gateway never leaves open to a
        // citizen token.
        upsert(citizenUpsert(OWNER, OWNER)).andExpect(status().isOk());

        String bridgeSearch = """
                {
                  "requestInfo": {},
                  "criteria": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
                    "limit": 1,
                    "offset": 0
                  }
                }
                """.formatted(OWNER);

        search(bridgeSearch)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)));

        String bridgeList = """
                {
                  "requestInfo": {},
                  "criteria": { "tenantId": "pg.citya", "preferenceCode": "USER_NOTIFICATION_PREFERENCES" }
                }
                """;

        search(bridgeList)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferences", hasSize(1)));
    }

    @Test
    void ignoresRoleCasingWhenDecidingPrivilege() throws Exception {
        String adminUpsert = """
                {
                  "RequestInfo": { "userInfo": { "uuid": "%s",
                                                 "roles": [ { "code": "superuser", "tenantId": "pg.citya" } ] } },
                  "preference": {
                    "userId": "%s",
                    "tenantId": "pg.citya",
                    "preferenceCode": "USER_PROFILE",
                    "payload": { "k": "v" }
                  }
                }
                """.formatted(OWNER, VICTIM);

        upsert(adminUpsert).andExpect(status().isOk());
    }
}
