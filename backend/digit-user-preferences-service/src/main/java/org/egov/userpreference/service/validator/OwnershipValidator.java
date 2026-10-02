package org.egov.userpreference.service.validator;

import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.service.enrichment.PreferenceEnricher;
import org.egov.userpreference.utils.CustomException;
import org.egov.userpreference.utils.ErrorCodes;
import org.egov.userpreference.utils.StringUtil;
import org.egov.userpreference.web.model.Preference;
import org.egov.userpreference.web.model.PreferenceCriteria;
import org.egov.userpreference.web.model.RequestInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Keeps a citizen to their own preference record.
 *
 * <p>Both endpoints key on the {@code userId} in the request body, never on
 * the authenticated principal: the token uuid is used only for the audit
 * columns. Without a check here any citizen who can reach the route can read
 * or overwrite another citizen's notification consent, and {@code _search}
 * accepts {@code tenantId} alone, which hands over the uuids to aim at. That
 * is BOLA (CWE-639), and it is the shape the Go service shipped with.
 *
 * <p>Three rules, each chosen to fail closed:
 *
 * <ul>
 *   <li><b>Who is calling</b> is resolved by {@link PreferenceEnricher#userIdFrom},
 *       the same method that stamps the audit columns. Anything else lets the
 *       two disagree, which is how a caller identified well enough to be
 *       recorded as the author can still skip the check.</li>
 *   <li><b>Only a wholly absent {@code userInfo}</b> counts as
 *       service-to-service. novu-bridge posts an empty {@code requestInfo}
 *       for the consent gate and the configurator listing; the gateway is the
 *       authN boundary and populates {@code userInfo} for anything carrying a
 *       citizen token. A {@code userInfo} that is present but yields no
 *       principal is an authenticated caller we cannot identify, so it is
 *       denied rather than waved through.</li>
 *   <li><b>Privilege is tenant-scoped.</b> A role only lifts the check for
 *       records in its own tenant or a descendant of it, so an admin in one
 *       tenant cannot rewrite another tenant's citizens. A role with no
 *       tenant, or a target with no tenant, cannot be scoped and so does not
 *       confer privilege.</li>
 * </ul>
 *
 * <p>Enforcement can be switched off with
 * {@code user.preference.security.enforce-ownership=false} for a deployment
 * that needs the old behaviour while it adjusts a caller.
 */
@Component
@Slf4j
public class OwnershipValidator {

    @Value("${user.preference.security.enforce-ownership}")
    private boolean enforceOwnership;

    /**
     * Roles that may act on a preference belonging to someone else, within
     * their own tenant.
     *
     * <p>{@code EMPLOYEE} is deliberately not a default: HRMS forces that role
     * onto every employee it creates, so including it would hand tenant-wide
     * read and write over citizens' consent to every field worker and CSR
     * rather than to administrators.
     */
    @Value("${user.preference.security.privileged-roles}")
    private List<String> privilegedRoles;

    /** An upsert may only write the caller's own record. */
    public void validateUpsert(Preference preference, RequestInfo requestInfo) {
        String principal = principal(requestInfo);
        if (principal == null || isPrivilegedFor(requestInfo, preference.getTenantId())) {
            return;
        }
        if (!principal.equals(StringUtil.trimToEmpty(preference.getUserId()))) {
            log.warn("Rejecting an upsert for another user: principal={}, body userId={}",
                    principal, preference.getUserId());
            throw CustomException.forbidden(ErrorCodes.NOT_AUTHORIZED,
                    "userId must match the authenticated user", requestInfo);
        }
    }

    /**
     * A search must be narrowed to the caller's own record. A tenant-only
     * search is what turns this from "read one record" into "enumerate every
     * citizen's consent in the tenant", so an absent {@code userId} is
     * rejected rather than silently scoped.
     */
    public void validateSearch(PreferenceCriteria criteria, RequestInfo requestInfo) {
        String principal = principal(requestInfo);
        if (principal == null || isPrivilegedFor(requestInfo, criteria.getTenantId())) {
            return;
        }
        if (!principal.equals(StringUtil.trimToEmpty(criteria.getUserId()))) {
            log.warn("Rejecting a search for another user: principal={}, criteria userId={}",
                    principal, criteria.getUserId());
            throw CustomException.forbidden(ErrorCodes.NOT_AUTHORIZED,
                    "criteria.userId must match the authenticated user", requestInfo);
        }
    }

    /**
     * The caller's identity, or null when the request carries no
     * {@code userInfo} at all and is therefore service-to-service. An empty
     * string means "authenticated but unidentifiable", which matches no
     * {@code userId} and so denies.
     */
    private String principal(RequestInfo requestInfo) {
        if (!enforceOwnership || requestInfo == null || requestInfo.getUserInfo() == null) {
            return null;
        }
        return PreferenceEnricher.userIdFrom(requestInfo);
    }

    /** True when the caller holds a privileged role covering {@code targetTenantId}. */
    private boolean isPrivilegedFor(RequestInfo requestInfo, String targetTenantId) {
        List<RequestInfo.Role> roles = requestInfo.getUserInfo().getRoles();
        if (roles == null || roles.isEmpty() || StringUtil.isEmpty(targetTenantId)) {
            return false;
        }
        Set<String> allowed = privilegedRoles.stream()
                .map(role -> role.trim().toUpperCase())
                .filter(role -> !role.isEmpty())
                .collect(Collectors.toSet());

        return roles.stream().anyMatch(role ->
                StringUtil.isNotEmpty(role.getCode())
                        && allowed.contains(role.getCode().toUpperCase())
                        && covers(role.getTenantId(), targetTenantId.trim()));
    }

    /**
     * Whether a role granted in {@code roleTenantId} reaches
     * {@code targetTenantId}. Tenant ids are dot-separated and hierarchical,
     * so a role at {@code pg} covers {@code pg.citya} but one at
     * {@code pg.cityb} does not.
     */
    private boolean covers(String roleTenantId, String targetTenantId) {
        if (StringUtil.isEmpty(roleTenantId)) {
            return false;
        }
        String roleTenant = roleTenantId.trim();
        return targetTenantId.equals(roleTenant) || targetTenantId.startsWith(roleTenant + ".");
    }
}
