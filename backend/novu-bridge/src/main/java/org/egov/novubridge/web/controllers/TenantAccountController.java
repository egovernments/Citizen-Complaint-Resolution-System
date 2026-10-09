package org.egov.novubridge.web.controllers;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.ChannelReadiness;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.util.Values;
import org.egov.tracer.model.CustomException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The internal tenant account admin API (#2203). Machine callers only: InternalAuthFilter admits
 * {@code X-Novu-Bridge-Token} = {@code novu.bridge.internal.admin.token} (the send token may read a
 * tenant's status), and Kong terminates the prefix. Provider credentials go to the tenant's own
 * Novu organization and are never returned: every read is the {@link IntegrationProjection}
 * allowlist.
 *
 * <pre>
 * POST /tenants/{tenantId}/_provision          idempotent; a re-call returns the current state
 * GET  /tenants/{tenantId}                     state + which channels have a working provider
 * POST /tenants/{tenantId}/_deprovision        integrations deleted, key regenerated and forgotten
 * GET  /tenants/{tenantId}/providers           the tenant's providers, no credentials
 * POST /tenants/{tenantId}/providers           {type, name, credentials, active?}
 * POST /tenants/{tenantId}/providers/_update   {id, name?, credentials?, active?}
 * POST /tenants/{tenantId}/providers/_delete   {id}
 * GET  /tenants                                every tenant account's state
 * POST /tenants/_backfill                      {tenantIds:[...]}: provision each, report each
 * </pre>
 */
@Slf4j
@RestController
@RequestMapping("/novu-adapter/v1/tenants")
public class TenantAccountController {

    private static final int MAX_BACKFILL = 500;

    private final TenantAccountService accounts;
    private final ChannelReadiness readiness;
    private final ProviderController providers;

    public TenantAccountController(TenantAccountService accounts, ChannelReadiness readiness,
                                   ProviderController providers) {
        this.accounts = accounts;
        this.readiness = readiness;
        this.providers = providers;
    }

    @PostMapping("/{tenantId}/_provision")
    public ResponseEntity<Map<String, Object>> provision(@PathVariable("tenantId") String tenantId) {
        TenantAccountService.ProvisionResult result = accounts.provision(tenantId);
        Map<String, Object> out = new LinkedHashMap<>(result.state());
        out.put("organizationCreated", result.organizationCreated());
        out.put("workflowsCreated", result.workflowsCreated());
        return ResponseEntity.ok(Map.of("data", out));
    }

    @GetMapping("/{tenantId}")
    public ResponseEntity<Map<String, Object>> status(@PathVariable("tenantId") String tenantId) {
        String root = TenantAccountService.rootOf(tenantId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tenantId", root);
        out.put("tenantAccountsEnabled", accounts.enabled());
        Map<String, Object> state = accounts.find(root).orElse(null);
        out.put("provisioned", state != null && Boolean.TRUE.equals(state.get("provisioned")));
        out.put("status", state == null ? "NOT_PROVISIONED" : state.get("status"));
        if (state != null) {
            out.put("account", state);
        }
        if (Boolean.TRUE.equals(out.get("provisioned"))) {
            Map<String, Object> channels = new LinkedHashMap<>();
            try {
                readiness.evaluateAll(accounts.requireAccount(root), root)
                        .forEach((code, r) -> channels.put(code, r.toMap()));
                out.put("channels", channels);
            } catch (AccountException e) {
                out.put("channelsError", Map.of("code", e.code(), "message", e.getMessage()));
            }
        }
        return ResponseEntity.ok(Map.of("data", out));
    }

    @PostMapping("/{tenantId}/_deprovision")
    public ResponseEntity<Map<String, Object>> deprovision(@PathVariable("tenantId") String tenantId) {
        return ResponseEntity.ok(Map.of("data", accounts.deprovision(tenantId)));
    }

    @GetMapping("/{tenantId}/providers")
    public ResponseEntity<Map<String, Object>> listProviders(@PathVariable("tenantId") String tenantId) {
        List<Map<String, Object>> data = providers.listProjected(accounts.requireAccount(tenantId));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        out.put("total", data.size());
        return ResponseEntity.ok(out);
    }

    @PostMapping("/{tenantId}/providers")
    public ResponseEntity<?> createProvider(@PathVariable("tenantId") String tenantId,
                                            @RequestBody Map<String, Object> body) {
        NovuAccount account = accounts.requireAccount(tenantId);
        return providers.createProvider(account, body);
    }

    @PostMapping("/{tenantId}/providers/_update")
    public ResponseEntity<?> updateProvider(@PathVariable("tenantId") String tenantId,
                                            @RequestBody Map<String, Object> body) {
        return providers.updateProvider(accounts.requireAccount(tenantId), body);
    }

    @PostMapping("/{tenantId}/providers/_delete")
    public ResponseEntity<?> deleteProvider(@PathVariable("tenantId") String tenantId,
                                            @RequestBody Map<String, Object> body) {
        return providers.deleteProvider(accounts.requireAccount(tenantId), body);
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list() {
        List<Map<String, Object>> data = accounts.list();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", data);
        out.put("total", data.size());
        return ResponseEntity.ok(out);
    }

    /**
     * Provisions each tenant in turn (idempotent: already provisioned ones are no-ops) and reports
     * each outcome; one failure does not stop the rest. The backfill path for tenants created
     * before #2203, or while Novu was down.
     */
    @PostMapping("/_backfill")
    public ResponseEntity<Map<String, Object>> backfill(@RequestBody Map<String, Object> body) {
        List<Object> requested = Values.asList(body == null ? null : body.get("tenantIds"));
        if (requested == null || requested.isEmpty()) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_REQUEST", "tenantIds is required");
        }
        if (requested.size() > MAX_BACKFILL) {
            throw new AccountException(HttpStatus.BAD_REQUEST, "NB_INVALID_REQUEST",
                    "at most " + MAX_BACKFILL + " tenantIds per call");
        }
        List<Map<String, Object>> results = new ArrayList<>();
        int failed = 0;
        for (Object item : requested) {
            String tenantId = Values.str(item);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("tenantId", tenantId);
            try {
                TenantAccountService.ProvisionResult result = accounts.provision(tenantId);
                row.put("status", result.state().get("status"));
                row.put("organizationCreated", result.organizationCreated());
                row.put("organizationId", result.state().get("organizationId"));
            } catch (AccountException e) {
                failed++;
                row.put("status", "ERROR");
                row.put("code", e.code());
                row.put("message", e.getMessage());
            }
            results.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("data", results);
        out.put("total", results.size());
        out.put("failed", failed);
        return ResponseEntity.ok(out);
    }

    @ExceptionHandler(AccountException.class)
    ResponseEntity<Map<String, Object>> refused(AccountException e) {
        return e.toResponse();
    }

    @ExceptionHandler(ProviderController.Refusal.class)
    ResponseEntity<Map<String, Object>> refused(ProviderController.Refusal refusal) {
        return refusal.toResponse();
    }

    /** Catalog validation and Novu failures arrive as tracer CustomExceptions: 400 or 502 with their code. */
    @ExceptionHandler(CustomException.class)
    ResponseEntity<Map<String, Object>> failed(CustomException e) {
        HttpStatus status = e.getCode() != null && e.getCode().startsWith("NB_NOVU_") ? HttpStatus.BAD_GATEWAY
                : "NB_TENANT_ACCOUNT_UNAVAILABLE".equals(e.getCode()) ? HttpStatus.SERVICE_UNAVAILABLE
                : HttpStatus.BAD_REQUEST;
        return new AccountException(status, e.getCode(), e.getMessage()).toResponse();
    }
}
