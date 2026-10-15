package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.egov.novubridge.web.models.IntegrationListResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Read-only list of the Novu integrations, through the {@link IntegrationProjection} allowlist:
 * no credentials and never the Novu ApiKey leave this service.
 */
@RestController
@RequestMapping("/novu-adapter/v1")
public class IntegrationController {

    private final NovuClient novuClient;
    private TenantAccountService tenantAccounts;
    private NovuBridgeConfiguration config;

    public IntegrationController(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    /** Per-tenant accounts (#2203); absent = the shared account only, as before. */
    @Autowired(required = false)
    public void setTenantAccounts(TenantAccountService tenantAccounts, NovuBridgeConfiguration config) {
        this.tenantAccounts = tenantAccounts;
        this.config = config;
    }

    /**
     * With {@code ?tenantId=<workspace>} and a workspace that has its own Novu organization, that
     * organization's integrations; otherwise the shared account's. {@code account} says which, and
     * whether the caller may manage it.
     */
    @GetMapping("/integrations")
    public ResponseEntity<IntegrationListResponse> integrations() {
        String selector = AccountSelection.currentSelector();
        NovuAccount account = AccountSelection.select(tenantAccounts, selector, ProxyAuthFilter.currentCaller(), false);
        NovuClient.NovuResponse novuResponse = account == null
                ? novuClient.listIntegrations() : novuClient.listIntegrations(account);
        // Surface upstream failures instead of returning 200 with an empty list.
        if (novuResponse == null || novuResponse.getStatusCode() == null
                || novuResponse.getStatusCode() < 200 || novuResponse.getStatusCode() >= 300) {
            return new ResponseEntity<>(HttpStatus.BAD_GATEWAY);
        }
        List<Map<String, Object>> integrations = IntegrationProjection.extractList(novuResponse.getResponse());
        List<Map<String, Object>> projected = new ArrayList<>(integrations.size());
        for (Map<String, Object> integration : integrations) {
            projected.add(IntegrationProjection.projectListItem(integration));
        }
        IntegrationListResponse response = IntegrationListResponse.builder()
                .data(projected)
                .total((long) projected.size())
                .account(tenantAccounts == null ? null : AccountSelection.describe(tenantAccounts, selector, account,
                        ProxyAuthFilter.currentCaller(), config == null ? Set.of() : config.providerAdminStateTenants()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @ExceptionHandler(AccountException.class)
    ResponseEntity<Map<String, Object>> refused(AccountException refusal) {
        return refusal.toResponse();
    }
}
