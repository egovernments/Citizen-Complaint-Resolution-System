import { Loader } from "@egovernments/digit-ui-components";
import { Field as V2Field, Select as V2Select } from "@egovernments/digit-ui-components-v2";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Employee-side complaint-type picker driven by the configurable complaint
 * hierarchy (RAINMAKER-PGR.ComplaintHierarchyDefinition + ClassificationNode).
 * A FormComposerV2 `type:"component"` field (same contract as
 * PGRBoundaryComponent: receives { onSelect } and writes form values via
 * onSelect(fieldName, value)).
 *
 * It renders one dependent dropdown per level. On leaf select it writes the
 * chosen ServiceDef into BOTH `SelectComplaintType` and `SelectSubComplaintType`
 * so the existing payload util (getEffectiveServiceCode) and the submit gating
 * keep working unchanged. Full tree — no department scoping (per product
 * decision for the employee create screen).
 *
 * Mounted only when a hierarchy exists for the tenant; createComplaintForm
 * keeps the flat dropdowns otherwise.
 */
const ComplaintHierarchyComponent = ({ onSelect }) => {
  const { t } = useTranslation();
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();

  const { data: hier, isLoading: loadingHier } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ClassificationNode" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const allDefs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter(
          (d) => d?.active !== false
        );
        const allNodes = raw?.["RAINMAKER-PGR"]?.ClassificationNode || [];
        // Prefer a definition that actually has nodes (skip stray/empty ones),
        // then scope nodes to that hierarchyType.
        const def =
          allDefs.find((d) => allNodes.some((n) => n?.hierarchyType === d?.hierarchyType)) ||
          allDefs[0] ||
          null;
        const nodes = def ? allNodes.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
        return { def, nodes };
      },
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_EMP" }
  );

  const { data: serviceDefs, isLoading: loadingDefs } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ServiceDefs" }],
    { cacheTime: Infinity, select: (raw) => raw?.["RAINMAKER-PGR"]?.ServiceDefs },
    { schemaCode: "SERVICE_DEFS_MASTER_DATA" }
  );

  const def = hier?.def;
  const nodes = hier?.nodes || [];
  const levels = useMemo(
    () => (def ? [...(def.levels || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []),
    [def]
  );
  const [sel, setSel] = useState([]);

  if (loadingHier || loadingDefs) return <Loader />;
  if (!def || levels.length === 0) {
    return (
      <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)" }}>
        {t("CS_NO_COMPLAINT_HIERARCHY") === "CS_NO_COMPLAINT_HIERARCHY"
          ? "No complaint hierarchy configured for this tenant."
          : t("CS_NO_COMPLAINT_HIERARCHY")}
      </p>
    );
  }

  const leafIdx = levels.length - 1;

  const labelFor = (lvl) => {
    const key = (def.hierarchyType + "_" + lvl.levelCode).toUpperCase();
    const v = t(key);
    return v === key ? lvl.label || lvl.levelCode : v;
  };

  const optionsForLevel = (i) => {
    const lvl = levels[i];
    const parentCode = i === 0 ? null : sel[i - 1];
    if (i > 0 && !parentCode) return [];
    if (lvl.isLeafServiceCode) {
      return (serviceDefs || [])
        .filter((s) => {
          const link = s.parentCode ?? s.sector ?? s.menuPath;
          return parentCode ? link === parentCode : true;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => ({ value: s.serviceCode, label: s.name ? t(s.name) : s.serviceCode }));
    }
    return (nodes || [])
      .filter((n) => n.levelCode === lvl.levelCode && n.active !== false)
      .filter((n) => (i === 0 ? !n.parentCode : n.parentCode === parentCode))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((n) => ({ value: n.code, label: n.name || n.code }));
  };

  const handleChange = (i, value) => {
    const next = sel.slice();
    next[i] = value || null;
    for (let j = i + 1; j < next.length; j++) next[j] = null;
    setSel(next);
    if (levels[i].isLeafServiceCode) {
      const leaf = (serviceDefs || []).find((s) => s.serviceCode === value) || null;
      // Write BOTH fields the payload + gating read. Leaf in both makes
      // getEffectiveServiceCode return the leaf serviceCode.
      onSelect("SelectComplaintType", leaf);
      onSelect("SelectSubComplaintType", leaf);
    } else {
      onSelect("SelectComplaintType", undefined);
      onSelect("SelectSubComplaintType", undefined);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {levels.map((lvl, i) => {
        const disabled = i > 0 && !sel[i - 1];
        const id = `ch-emp-${lvl.levelCode}`;
        return (
          <V2Field key={lvl.levelCode} label={labelFor(lvl)} required htmlFor={id}>
            <V2Select
              id={id}
              value={sel[i] || undefined}
              disabled={disabled}
              onValueChange={(v) => handleChange(i, v)}
              options={optionsForLevel(i)}
              placeholder={disabled ? "Select the level above first" : `Select ${labelFor(lvl)}`}
            />
          </V2Field>
        );
      })}
    </div>
  );
};

export default ComplaintHierarchyComponent;
