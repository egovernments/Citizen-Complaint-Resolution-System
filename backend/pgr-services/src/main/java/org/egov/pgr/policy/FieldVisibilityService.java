package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.springframework.beans.BeanWrapper;
import org.springframework.beans.BeanWrapperImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Field-level Tier-2 PDP: masks individual fields on each result (e.g. citizen.mobileNumber) per
 * the visibility rules declared on the matching Action's {@code resource} JSON object — see the
 * field-level attribute access design doc. Complements {@link SearchAccessPolicyService} (which
 * decides "can this role see the record at all"); this decides "which fields of a visible record
 * this role may see". Reuses the same JsonLogic condition evaluator and input-document contract.
 *
 * A field whose condition evaluates true is left untouched. A field whose condition evaluates
 * false (or can't be evaluated — {@link PolicyEvaluator} itself fails closed) is masked via
 * {@link MaskingStrategy}, applied through Spring's {@link BeanWrapperImpl} against the typed
 * response object graph (e.g. {@code citizen.mobileNumber} -> {@code Service.getCitizen()
 * .getMobileNumber()}) — no reflection code of our own, no JSON round-trip.
 */
@Component
@Slf4j
public class FieldVisibilityService {

    private final AccessPolicyRegistry registry;
    private final PolicyEvaluator evaluator;
    private final PolicyInputBuilder inputBuilder;

    @Autowired
    public FieldVisibilityService(AccessPolicyRegistry registry, PolicyEvaluator evaluator, PolicyInputBuilder inputBuilder) {
        this.registry = registry;
        this.evaluator = evaluator;
        this.inputBuilder = inputBuilder;
    }

    /**
     * No-op (and no MDMS/accesscontrol lookup beyond the shared {@link AccessPolicyRegistry}
     * cache) when no field-visibility rules are configured for actionUrl/resourceType — existing
     * behavior is unaffected until an operator adds a rule.
     */
    public void apply(RequestInfo requestInfo, String tenantId, AnalyticsScope scope,
                       String actionUrl, String resourceType, List<ServiceWrapper> wrappers) {
        if (CollectionUtils.isEmpty(wrappers))
            return;

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(actionUrl, requestInfo, tenantId, resourceType);
        if (rules.isEmpty())
            return;

        Map<String, Object> userDoc = inputBuilder.buildUserDoc(requestInfo, scope);

        for (ServiceWrapper wrapper : wrappers) {
            Service service = wrapper.getService();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("user", userDoc);
            data.put("resource", inputBuilder.buildResourceDoc(service));

            BeanWrapper beanWrapper = null;
            for (Map.Entry<String, FieldVisibilityRule> entry : rules.entrySet()) {
                String path = entry.getKey();
                FieldVisibilityRule rule = entry.getValue();

                if (evaluator.isAllowed(rule.getConditionJson(), data))
                    continue;

                if (beanWrapper == null)
                    beanWrapper = new BeanWrapperImpl(service);
                maskField(beanWrapper, path, rule.getOnDeny(), service.getServiceRequestId());
            }
        }
    }

    private void maskField(BeanWrapper beanWrapper, String path, Map<String, Object> onDeny, String serviceRequestId) {
        try {
            Object current = beanWrapper.getPropertyValue(path);
            if (current == null)
                return; // nothing to mask
            beanWrapper.setPropertyValue(path, MaskingStrategy.apply(current, onDeny));
        } catch (Exception e) {
            // Most commonly a null intermediate object (e.g. no citizen enriched onto this
            // wrapper) — there's genuinely nothing exposed in that case, so this is expected, not
            // an error condition worth alarming on.
            log.debug("FieldVisibilityService: could not evaluate/mask path '{}' on serviceRequestId={} — nothing to mask: {}",
                    path, serviceRequestId, e.getMessage());
        }
    }
}
