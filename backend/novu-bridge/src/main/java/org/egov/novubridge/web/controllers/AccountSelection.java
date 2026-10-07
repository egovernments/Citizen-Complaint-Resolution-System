package org.egov.novubridge.web.controllers;

import org.egov.novubridge.service.account.AccountException;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.service.account.TenantAccountService;
import org.egov.novubridge.web.filters.ProxyAuthFilter;
import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Which Novu account a Configurator request acts on (#2203). The selector is the {@code tenantId}
 * QUERY parameter (the Configurator sends its workspace), the same value ProxyAuthFilter decides
 * the owning-state check on, so the filter and the controllers can never disagree:
 * <ul>
 *   <li>no selector, feature off, or a root without its own account: {@code null}, the shared
 *       deployment account, under exactly the pre-#2203 rules (the owning-state check);</li>
 *   <li>a root with its own account: that account, for a caller holding an admin role at that
 *       root (writes) or reading within its own tenants (reads). Anyone else is refused, the
 *       admin of a state that owns the shared providers included: one workspace's credentials
 *       are not another's to manage.</li>
 * </ul>
 */
final class AccountSelection {

    static final String SELECTOR = "tenantId";

    private AccountSelection() {
    }

    /** The current request's {@code tenantId} query/form parameter, or null outside a request. */
    static String currentSelector() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            String value = attributes.getRequest().getParameter(SELECTOR);
            return StringUtils.hasText(value) ? value.trim() : null;
        }
        return null;
    }

    static NovuAccount select(TenantAccountService accounts, String selector, ProxyAuthFilter.Caller caller,
                              boolean write) {
        if (accounts == null || !accounts.enabled() || !StringUtils.hasText(selector)
                || !accounts.isProvisioned(selector)) {
            return null;
        }
        String root = TenantAccountService.rootOf(selector);
        if (caller != null) {
            boolean allowed = write ? caller.administersStateOf(root)
                    : caller.mayRead(selector) || caller.administersStateOf(root);
            if (!allowed) {
                throw new AccountException(HttpStatus.FORBIDDEN, "NB_TENANT_NOT_ALLOWED", write
                        ? "Workspace " + root + " has its own notification account; managing it needs an admin role "
                                + "held at " + root
                        : "Workspace " + root + "'s notification account is not one of your tenants");
            }
        }
        return accounts.accountFor(selector);
    }

    /**
     * What the Configurator shows above its provider list: whose account it is looking at, and
     * whether this caller may change it. Never a key.
     */
    static Map<String, Object> describe(TenantAccountService accounts, String selector, NovuAccount account,
                                        ProxyAuthFilter.Caller caller, java.util.Set<String> owningStates) {
        Map<String, Object> out = new LinkedHashMap<>();
        boolean enabled = accounts != null && accounts.enabled();
        out.put("tenantAccountsEnabled", enabled);
        if (account != null) {
            out.put("mode", "TENANT");
            out.put("tenantId", account.tenantRoot());
            out.put("status", "PROVISIONED");
            out.put("manageable", caller == null || caller.administersStateOf(account.tenantRoot()));
            return out;
        }
        out.put("mode", "SHARED");
        String root = null;
        if (StringUtils.hasText(selector)) {
            try {
                root = TenantAccountService.rootOf(selector);
            } catch (AccountException ignored) {
                root = null;
            }
        }
        out.put("tenantId", root);
        String status = "NOT_PROVISIONED";
        if (enabled && root != null) {
            try {
                Object s = accounts.find(root).map(v -> v.get("status")).orElse(null);
                if (s != null) {
                    status = s.toString();
                }
            } catch (RuntimeException e) {
                status = "UNKNOWN";
            }
        } else if (!enabled) {
            status = "DISABLED";
        }
        out.put("status", status);
        out.put("manageable", caller == null || caller.administersAnyOf(owningStates));
        return out;
    }
}
