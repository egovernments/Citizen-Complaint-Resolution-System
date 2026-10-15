// ours (#1857, 2026-10-15): File a Complaint at a STATE whose boundaries live at its counties (the county layout).
// A complaint belongs to a county and is filed in its tree, so at such a state the route first asks "in which county?"
// and opens that county's own create page (/<county-slug>/digit-ui/employee/pgr/create-complaint), where the form,
// the locality cascade and the complaint's tenant are the county's. Only the counties the user can enter are listed
// (Digit.Utils.tenantScope, the identity service's rule). A tenant with its own hierarchy (a county; a flat-layout
// state) gets the form as before; so does any tenant whose definitions cannot be read.
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const say = (t, key, fallback) => {
  const v = t(key);
  return v && v !== key ? v : fallback;
};

export const stateCounties = (tenantId) =>
  Digit?.Utils?.tenantScope?.enterableChildTenants?.(
    tenantId,
    Digit?.SessionStorage?.get?.("initData")?.tenants || [],
    Digit?.UserService?.getUser?.()?.info?.roles || []
  ) || [];

const CountyFirst = ({ component: Component }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const counties = useMemo(() => stateCounties(tenantId), [tenantId]);
  // null = checking; true = the tenant has its own hierarchy (or we cannot tell): the form as before
  const [own, setOwn] = useState(counties.length ? null : true);

  useEffect(() => {
    if (!counties.length) return undefined;
    let live = true;
    Digit.CustomService.getResponse({
      url: "/boundary-service/boundary-hierarchy-definition/_search",
      method: "POST",
      useCache: false,
      body: { BoundaryTypeHierarchySearchCriteria: { tenantId, limit: 1, offset: 0 } },
    })
      .then((r) => live && setOwn(Number(r?.totalCount ?? (r?.BoundaryHierarchy || []).length) > 0))
      .catch(() => live && setOwn(true));
    return () => {
      live = false;
    };
  }, [tenantId, counties.length]);

  if (own === null) return null;
  if (own) return <Component />;
  const slug = Digit.Utils.tenantScope.tenantSlug;
  return (
    <div className="digit-card-component" data-testid="pgr-county-first" style={{ maxWidth: 640 }}>
      <h2 className="digit-header-content">{say(t, "CS_FILE_COMPLAINT_CHOOSE_COUNTY", "File the complaint in which county?")}</h2>
      <p>{say(t, "CS_FILE_COMPLAINT_CHOOSE_COUNTY_HINT", "A complaint is filed in the county where it happened, with that county's localities.")}</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {counties.map((c) => (
          <li key={c.code} style={{ margin: "8px 0" }}>
            <a className="digit-link" href={`/${slug(c)}/digit-ui/employee/pgr/create-complaint`}>
              {say(t, c.i18nKey || `TENANT_TENANTS_${String(c.code).toUpperCase().replace(/\./g, "_")}`, c.name || c.code)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CountyFirst;
