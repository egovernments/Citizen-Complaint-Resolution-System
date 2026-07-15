import React, { useState, useEffect } from "react";
import { InboxSearchComposer, Loader } from "@egovernments/digit-ui-components";
import { useTranslation } from "react-i18next";
import { Redirect } from "react-router-dom";
import _ from "lodash";
import AdminSearchConfig from "../../configs/AdminSearchConfig";

/**
 * PGRAdminSearch — SUPERUSER-only cross-department complaint search
 * (/employee/pgr/admin-search).
 *
 * Same config-driven pattern as inbox-v2 (InboxSearchComposer): the filter
 * sidebar, search bar, results table and pagination all come from
 * AdminSearchConfig + UICustomizations.AdminSearchConfig. This page only:
 *  1. gates on the SUPERUSER role (everyone else is redirected to /employee);
 *  2. loads common-masters.Department and injects the options — plus the
 *     "No department (N/A)" sentinel — into the filter's multiselect;
 *  3. caches a code/name → label map (SessionStorage) so the results table can
 *     normalise the inconsistently-stored additionalDetail.department values.
 *
 * Backend: POST /pgr-services/v2/request/_admin/_search (PR #1260) via the
 * pgr.useAdminComplaintSearch hook.
 */
const PGRAdminSearch = () => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();

  const roles = Digit.UserService.getUser()?.info?.roles?.map((r) => r?.code) || [];
  const isSuperUser = roles.includes("SUPERUSER");

  // Departments of the logged-in (city) tenant.
  const { data: departments, isLoading } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "common-masters",
    [{ name: "Department" }],
    {
      select: (data) => data?.["common-masters"]?.Department || [],
      enabled: isSuperUser,
    }
  );

  // Config lives in state so the reference stays stable across renders —
  // a fresh object per render makes the composer wipe the form and refetch
  // on every keystroke (CCRS#558).
  const [pageConfig, setPageConfig] = useState(null);

  useEffect(() => {
    if (!isSuperUser || isLoading) return;
    const cfg = _.cloneDeep(AdminSearchConfig());

    const deptLabel = (d) => {
      const key = `COMMON_MASTERS_DEPARTMENT_${d.code}`;
      const v = t(key);
      return v === key ? d.name || d.code : v;
    };
    const list = Array.isArray(departments) ? departments.filter((d) => d?.code) : [];
    const options = [
      { code: "NA", i18nKey: t("ES_PGR_ADMIN_DEPT_NA") },
      ...list.map((d) => ({ code: d.code, i18nKey: deptLabel(d) })),
    ];
    cfg.sections.filter.uiConfig.fields[0].populators.options = options;

    // code/name → label map for the results table's Department column
    // (additionalDetail.department is stored as code OR name depending on
    // how the complaint was created).
    const map = {};
    list.forEach((d) => {
      const label = deptLabel(d);
      map[d.code] = label;
      if (d.name) map[d.name] = label;
    });
    Digit.SessionStorage.set("ADMIN_SEARCH_DEPT_MAP", map);

    setPageConfig(cfg);
  }, [isSuperUser, isLoading, departments]);

  if (!isSuperUser) {
    return <Redirect to={`/${window?.contextPath}/employee`} />;
  }
  if (isLoading || !pageConfig) {
    return <Loader />;
  }

  const headingKey = "ES_PGR_ADMIN_SEARCH";
  const heading = (() => {
    const v = t(headingKey);
    return v === headingKey ? "Admin Complaint Search" : v;
  })();

  return (
    <div className="v2-pgr-inbox v2-scope">
      <header className="v2-employee-page-header">
        <h1>{heading}</h1>
      </header>
      <div className="digit-inbox-search-wrapper">
        <InboxSearchComposer configs={pageConfig} />
      </div>
    </div>
  );
};

export default PGRAdminSearch;
