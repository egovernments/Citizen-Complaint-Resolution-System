package org.egov.novubridge.service.account;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.config.TenantAccountsConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** The Novu 2.3.0 user-session calls, with the response shapes the stock API returns. */
class NovuPlatformClientTest {

    private MockRestServiceServer novu;
    private NovuPlatformClient client;
    private TenantAccountsConfiguration accounts;

    @BeforeEach
    void setUp() {
        RestTemplate restTemplate = new RestTemplate();
        novu = MockRestServiceServer.bindTo(restTemplate).build();
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("http://novu-api:3000");
        accounts = TenantAccountServiceTest.accountsConfig();
        client = new NovuPlatformClient(restTemplate, config, accounts);
    }

    @Test
    void theProvisioningSequence() {
        novu.expect(requestTo("http://novu-api:3000/v1/auth/login")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("{\"email\":\"admin@example.test\",\"password\":\"Platform-Admin-1\"}"))
                .andRespond(withSuccess("{\"data\":{\"token\":\"jwt-1\"}}", MediaType.APPLICATION_JSON));
        novu.expect(requestTo("http://novu-api:3000/v1/organizations")).andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer jwt-1"))
                .andExpect(content().json("{\"name\":\"DIGIT tenant acme\"}"))
                .andRespond(withSuccess("{\"data\":{\"_id\":\"org-1\",\"name\":\"DIGIT tenant acme\"}}", MediaType.APPLICATION_JSON));
        novu.expect(requestTo("http://novu-api:3000/v1/auth/organizations/org-1/switch")).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"data\":\"jwt-org-1\"}", MediaType.APPLICATION_JSON));
        novu.expect(requestTo("http://novu-api:3000/v1/environments")).andExpect(header("Authorization", "Bearer jwt-org-1"))
                .andRespond(withSuccess("{\"data\":[{\"_id\":\"env-d\",\"name\":\"Development\",\"apiKeys\":[{\"key\":\"k-dev\"}]},"
                        + "{\"_id\":\"env-p\",\"name\":\"Production\",\"apiKeys\":[{\"key\":\"k-prod\"}]}]}", MediaType.APPLICATION_JSON));
        novu.expect(requestTo("http://novu-api:3000/v1/environments/api-keys/regenerate"))
                .andExpect(header(NovuPlatformClient.ENVIRONMENT_HEADER, "env-d"))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body("{\"data\":[]}"));

        String token = client.login();
        NovuPlatformClient.Organization org = client.createOrganization(token, "DIGIT tenant acme");
        String scoped = client.switchOrganization(token, org.id());
        List<NovuPlatformClient.Environment> environments = client.environments(scoped);
        client.regenerateApiKey(scoped, "env-d");

        assertEquals("org-1", org.id());
        assertEquals(new NovuPlatformClient.Environment("env-d", "Development", "k-dev"), environments.get(0));
        novu.verify();
    }

    @Test
    void aRefusedLogin_isNamedForWhatToFix_andNeverEchoesThePassword() {
        novu.expect(requestTo("http://novu-api:3000/v1/auth/login"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"message\":\"Incorrect email or password provided.\"}"));

        AccountException e = assertThrows(AccountException.class, client::login);

        assertEquals("NB_NOVU_PLATFORM_LOGIN_FAILED", e.code());
        assertFalse(e.getMessage().contains("Platform-Admin-1"));
    }

    @Test
    void anUnsetLogin_isAMisconfiguration_beforeAnyCall() {
        accounts.setAdminPassword("");
        assertEquals("NB_TENANT_ACCOUNTS_MISCONFIGURED", assertThrows(AccountException.class, client::login).code());
        novu.verify();
    }

    @Test
    void aPaidFeatureRefusal_isAPlatformFailure() {
        novu.expect(requestTo("http://novu-api:3000/v1/organizations"))
                .andRespond(withStatus(HttpStatus.PAYMENT_REQUIRED));
        assertEquals("NB_NOVU_PLATFORM_FAILED", assertThrows(AccountException.class,
                () -> client.createOrganization("jwt", "DIGIT tenant acme")).code());
    }
}
