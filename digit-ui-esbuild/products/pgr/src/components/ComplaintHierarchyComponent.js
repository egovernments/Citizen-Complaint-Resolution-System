import { Loader } from "@egovernments/digit-ui-components";
import { Field as V2Field, Select as V2Select } from "@egovernments/digit-ui-components-v2";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { complaintLabel } from "../utils/complaintLabel";

/**
 * Employee-side complaint-type picker driven by the configurable complaint
 * hierarchy (RAINMAKER-PGR.ComplaintHierarchyDefinition + ComplaintHierarchy).
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
 *
 * Single source of truth: RAINMAKER-PGR.ComplaintHierarchy is ONE adjacency
 * list holding both interior classification nodes and leaf complaint types.
 * Leaf rows carry department/slaHours; interior nodes omit them.
 */
const ComplaintHierarchyComponent = ({ onSelect, formData }) => {
  const { t } = useTranslation();
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();

  const { data: hier, isLoading: loadingHier } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const allDefs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter(
          (d) => d?.active !== false
        );
        const allRows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        // Prefer a definition that actually has rows (skip stray/empty ones),
        // then scope rows to that hierarchyType.
        const def =
          allDefs.find((d) => allRows.some((n) => n?.hierarchyType === d?.hierarchyType)) ||
          allDefs[0] ||
          null;
        const rows = def ? allRows.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
        // Split the single adjacency list: interior nodes drive the non-leaf
        // levels; leaf rows (carry department/slaHours) become the ServiceDef
        // options on the leaf level.
        const isLeaf = (n) => n?.department != null || n?.slaHours != null;
        const nodes = rows.filter((n) => !isLeaf(n));
        const serviceDefs = rows
          .filter((n) => isLeaf(n) && n.active !== false)
          .map((n) => ({ ...n, serviceCode: n.code, menuPath: n.parentCode }));
        return { def, nodes, serviceDefs };
      },
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_EMP" }
  );

  const def = hier?.def;
  const nodes = hier?.nodes || [];
  const serviceDefs = hier?.serviceDefs || [];
  const loadingDefs = false;
  const levels = useMemo(
    () => (def ? [...(def.levels || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []),
    [def]
  );
  const [sel, setSel] = useState([]);

  // Draft-restore repaint: the per-level selection is private state, so a
  // session-restored form has a valid SelectComplaintType while the dropdowns
  // render blank. While the picker is untouched, rebuild the visible chain by
  // walking parentCode up from the restored code (leaf or terminal interior
  // node). No onSelect emit — the value is already in the form. Placed BEFORE
  // the early returns below (hooks must run unconditionally).
  const restoreCode = formData?.SelectComplaintType?.serviceCode || formData?.SelectComplaintType?.code;
  useEffect(() => {
    if (!restoreCode || sel.some((s) => s != null)) return;
    if (!levels.length || (!nodes.length && !serviceDefs.length)) return;
    const byCode = new Map((nodes || []).map((n) => [n.code, n]));
    const leafDef = (serviceDefs || []).find((s) => s.serviceCode === restoreCode);
    if (!leafDef && !byCode.has(restoreCode)) return; // catalogue not loaded / foreign code
    const chain = [restoreCode];
    let parent = leafDef ? leafDef.parentCode ?? leafDef.menuPath : byCode.get(restoreCode)?.parentCode;
    while (parent) {
      chain.unshift(parent);
      parent = byCode.get(parent)?.parentCode ?? null;
    }
    setSel(levels.map((_, i) => chain[i] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreCode, nodes, serviceDefs, levels.length]);

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

  // Options for level `i` computed against an explicit selection array — lets
  // handleChange inspect a just-picked node's children before setSel commits.
  const optionsForLevelWith = (selArr, i) => {
    const lvl = levels[i];
    const parentCode = i === 0 ? null : selArr[i - 1];
    if (i > 0 && !parentCode) return [];
    if (lvl.isLeafServiceCode) {
      // Leaf rows link to their parent node strictly via parentCode (the single
      // adjacency list); no separate sector/menuPath master anymore.
      return (serviceDefs || [])
        .filter((s) => (parentCode ? s.parentCode === parentCode : true))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => ({ value: s.serviceCode, label: complaintLabel(t, s.serviceCode, s.name) }));
    }
    return (nodes || [])
      .filter((n) => n.levelCode === lvl.levelCode && n.active !== false)
      .filter((n) => (i === 0 ? !n.parentCode : n.parentCode === parentCode))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((n) => ({ value: n.code, label: complaintLabel(t, n.code, n.name) }));
  };

  const optionsForLevel = (i) => optionsForLevelWith(sel, i);

  // Shape an interior node like a leaf ServiceDef so a branch that stops before
  // the declared leaf level (e.g. 3 levels declared, this SECTOR has no
  // SUB_TYPE) can still be submitted — the deepest picked node becomes the
  // serviceCode (a real ComplaintHierarchy row, so the backend accepts it).
  const interiorAsServiceDef = (i, code) => {
    const node = (nodes || []).find(
      (n) => n.levelCode === levels[i].levelCode && n.code === code
    );
    if (!node) return null;
    return { ...node, serviceCode: node.code, menuPath: node.parentCode };
  };

  const handleChange = (i, value) => {
    const next = sel.slice();
    next[i] = value || null;
    for (let j = i + 1; j < next.length; j++) next[j] = null;
    setSel(next);
    if (!value) {
      onSelect("SelectComplaintType", undefined);
      onSelect("SelectSubComplaintType", undefined);
      return;
    }
    let picked;
    if (levels[i].isLeafServiceCode) {
      picked = (serviceDefs || []).find((s) => s.serviceCode === value) || null;
    } else {
      // Non-leaf: keep drilling while a deeper level still has options; once it
      // is terminal, submit with this interior node as the value.
      const hasDeeper =
        i + 1 < levels.length && optionsForLevelWith(next, i + 1).length > 0;
      picked = hasDeeper ? undefined : interiorAsServiceDef(i, value);
    }
    // Write BOTH fields the payload util + submit gating read. Same value in
    // both makes getEffectiveServiceCode return this code.
    onSelect("SelectComplaintType", picked);
    onSelect("SelectSubComplaintType", picked);
  };

  // Deepest selected level + whether it is terminal (next level has no options).
  // Deeper levels are then hidden so an empty mandatory dropdown can't block submit.
  const deepestSelected = sel.reduce((acc, v, idx) => (v != null ? idx : acc), -1);
  const terminalAt =
    deepestSelected >= 0 &&
    (deepestSelected + 1 >= levels.length ||
      optionsForLevelWith(sel, deepestSelected + 1).length === 0)
      ? deepestSelected
      : -1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {levels.map((lvl, i) => {
        // Drop deeper levels once the chosen branch terminates early.
        if (terminalAt >= 0 && i > terminalAt) return null;
        const disabled = i > 0 && !sel[i - 1];
        const opts = optionsForLevel(i);
        const id = `ch-emp-${lvl.levelCode}`;
        return (
          <V2Field key={lvl.levelCode} label={labelFor(lvl)} required={opts.length > 0} htmlFor={id}>
            <V2Select
              id={id}
              value={sel[i] || undefined}
              disabled={disabled}
              onValueChange={(v) => handleChange(i, v)}
              options={opts}
              // Complaint type/sub-type must always be type-to-filter (CCRS#941),
              // even for short lists — don't leave it to V2Select's length
              // threshold, which hid the search box on sub-types with <8 options.
              searchable
              searchPlaceholder={t("CS_COMMON_SEARCH") === "CS_COMMON_SEARCH" ? "Search" : t("CS_COMMON_SEARCH")}
              placeholder={disabled ? "Select the level above first" : `Select ${labelFor(lvl)}`}
            />
          </V2Field>
        );
      })}
    </div>
  );
};

export default ComplaintHierarchyComponent;
