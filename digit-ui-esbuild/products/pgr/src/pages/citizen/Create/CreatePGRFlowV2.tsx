/* eslint-disable @typescript-eslint/no-explicit-any */
// Citizen file-complaint flow — v2 (Tailwind + shadcn-style chrome).
//
// This is a strangler-fig replacement for the FormExplorer.js + steps-config/*
// + FormComposerV2 stack. The same 6-step shape is preserved so:
//   - the data shape submitted to /pgr/v1/_create is byte-identical
//   - the boundary, geolocation, and image-upload behaviour stays in the
//     existing components (PGRBoundaryComponent, GeoLocations, SelectImages),
//     just rendered inside v2 chrome
//   - server-side, redux, and post-submit response page see no change
//
// What changes vs FormExplorer:
//   - Tailwind / v2 components throughout the chrome (Stepper, ScreenContainer,
//     FormFooter, Card, Button, Field, RadioCards, Select, Textarea).
//   - Step 1 uses RadioCards for complaint type + sub-type instead of a tiny
//     Dropdown — much better mobile tap targets.
//   - Sticky action bar with Continue/Back, mobile-first layout.
//   - State managed locally via React hooks — no FormComposerV2 / hidden
//     react-hook-form coupling.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { complaintLabel } from "../../../utils/complaintLabel";
import { useDispatch } from "react-redux";
import { useHistory } from "react-router-dom";
import { useQueryClient } from "react-query";

import {
  ScreenContainer,
  ScreenHeader,
  FormFooter,
  Button,
  Card,
  Field,
  Textarea,
  Input,
  Select,
} from "@egovernments/digit-ui-components-v2";

/**
 * Resolve a translation key with an English fallback.
 *
 * react-i18next's `t()` echoes the key back when no translation is registered.
 * The CCRS localization bundle has the legacy keys (NEXT, SUBMIT, BACK,
 * CS_COMMON_FILE_A_COMPLAINT, CS_COMPLAINT_DETAILS_COMPLAINT_TYPE …) but not
 * the v2-specific descriptive ones (hints, intro copy). Until those land in
 * MDMS, fall back to a sensible English string when t() returns the key
 * unchanged — never show a raw `CS_…` token to the user.
 */
function tr(t: (k: string) => string, key: string, fallback: string): string {
  const out = t(key);
  return out === key ? fallback : out;
}

declare const Digit: any;

// Postal-code validation is config-driven so the UI honours the same length the
// backend does, per tenant (CCRS#722). The employee create form and the legacy
// FormExplorer already read `CORE_POSTAL_CONFIGS.postalCodePattern`; this citizen
// v2 flow previously had no postal validation at all, so a wrong (e.g. 6-digit
// Nominatim) pincode auto-filled from the map could be submitted. Optional field
// — only the format is enforced, and only when a value is present.
function getPostalConfig(): { pattern: string; errorMessage?: string } {
  const cfg = (window as any)?.globalConfigs?.getConfig?.("CORE_POSTAL_CONFIGS") || {};
  return {
    pattern: cfg.postalCodePattern || "^[0-9]{5}$",
    errorMessage: cfg.postalCodeErrorMessage, // optional explicit tenant override
  };
}

function isPostalCodeValid(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (s.length === 0) return true; // optional — validate format only when filled
  try {
    return new RegExp(getPostalConfig().pattern).test(s);
  } catch {
    return true; // a malformed configured pattern must never hard-block the form
  }
}

// Build an error message that reflects the CONFIGURED length, not a hard-coded
// count: the stock CS_COMPLAINT_POSTALCODE_INVALID_ERROR string is localized to
// "…5 digit…", which is wrong for a 4-digit tenant (CCRS#722). A tenant may pin
// its own message via CORE_POSTAL_CONFIGS.postalCodeErrorMessage; otherwise we
// derive the digit count from the pattern and use a length-parameterized key
// (falling back to a correct English string until that key is localized).
function postalErrorText(t: (k: string, opts?: any) => string): string {
  const { pattern, errorMessage } = getPostalConfig();
  if (errorMessage) return t(errorMessage);
  const m = String(pattern).match(/\{\s*(\d+)/); // ^[0-9]{4}$ -> "4"
  const len = m ? m[1] : null;
  if (len) {
    const key = "CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN";
    const out = t(key, { length: len });
    return out === key ? `Please enter a valid ${len}-digit postal code` : out;
  }
  const gkey = "CS_COMPLAINT_POSTALCODE_INVALID_ERROR_GENERIC";
  const gout = t(gkey);
  return gout === gkey ? "Please enter a valid postal code" : gout;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceDef {
  serviceCode: string;
  menuPath: string;
  menuPathName?: string;
  name?: string;
  department?: string;
  order?: number;
  // Optional denormalised hierarchy links (present once a tenant runs the
  // ServiceDefs backfill). The picker falls back to menuPath when absent.
  parentCode?: string;
  sector?: string;
}

// Configurable complaint hierarchy (RAINMAKER-PGR.ComplaintHierarchyDefinition):
// the number/identity of levels is pure data, mirroring boundary-service's
// HierarchyDefinition. Absent => legacy flat menuPath grouping.
interface HierarchyLevel {
  levelCode: string;
  order?: number;
  parentLevel?: string | null;
  isFreeText?: boolean;
  isLeafServiceCode?: boolean;
  label?: string;
}
interface ComplaintHierarchyDef {
  hierarchyType: string;
  active?: boolean;
  levels: HierarchyLevel[];
}
interface ClassificationNode {
  hierarchyType: string;
  levelCode: string;
  code: string;
  parentCode?: string | null;
  name?: string;
  order?: number;
  active?: boolean;
  path?: string;
}

interface BoundaryNode {
  code?: string;
  children?: unknown[];
  [key: string]: unknown;
}

interface GeoPoint {
  lat?: number | null;
  lng?: number | null;
  ward?: { code?: string } | null;
  pincode?: string | number | null;
}

interface FormData {
  SelectComplaintType?: ServiceDef | null;
  SelectSubComplaintType?: ServiceDef | null;
  GeoLocationsPoint?: GeoPoint | null;
  landmark?: string;
  postalCode?: string;
  SelectedBoundary?: BoundaryNode | null;
  description?: string;
  ComplaintImagesPoint?: string[]; // fileStoreIds
}

interface StepShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

const STEPS = [
  { id: "type", title: "Complaint" },
  { id: "map", title: "Pin location" },
  // Combined location step — replaces the previous separate
  // "address" (landmark + pincode) and "ward" (County / Sub-County /
  // Ward dropdowns) steps. Ward + pincode are auto-filled from the
  // map pin via the existing GeoLocations.resolveWard +
  // BoundaryComponent auto-cascade pipeline; the user only ever
  // types the optional landmark unless the auto-fill misses (in
  // which case the missing dropdown becomes interactive).
  { id: "location", title: "Location" },
  { id: "details", title: "Details" },
  { id: "photos", title: "Photos" },
] as const;

// ---------------------------------------------------------------------------
// Helpers (kept identical to the legacy FormExplorer so the API payload
// shape is preserved byte-for-byte)
// ---------------------------------------------------------------------------

function validateString(v: unknown): string {
  return typeof v === "string" && v.trim().length > 0 ? v : "";
}

function validateGeoLocation(v: { latitude?: number | null; longitude?: number | null }) {
  if (
    v &&
    typeof v.latitude === "number" &&
    typeof v.longitude === "number"
  ) {
    return { latitude: v.latitude, longitude: v.longitude };
  }
  return {};
}

function getEffectiveServiceCode(
  mainType: ServiceDef | null | undefined,
  subType: ServiceDef | null | undefined
): string | undefined {
  if (
    subType &&
    mainType &&
    subType.department === mainType.department &&
    subType.menuPath === mainType.menuPath &&
    subType.serviceCode !== mainType.serviceCode
  ) {
    return subType.serviceCode;
  }
  return mainType?.serviceCode;
}

function mapFormDataToRequest(formData: FormData, tenantId: string, user: any) {
  const timestamp = Date.now();
  const userInfo = user;
  const additionalDetail = {};
  const geoLocation = formData?.GeoLocationsPoint || { lat: null, lng: null };
  return {
    service: {
      active: true,
      tenantId,
      serviceCode: getEffectiveServiceCode(
        formData?.SelectComplaintType,
        formData?.SelectSubComplaintType
      ),
      description: formData?.description || "",
      applicationStatus: "CREATED",
      source: "web",
      citizen: userInfo,
      isDeleted: false,
      rowVersion: 1,
      address: {
        landmark: validateString(formData?.landmark),
        buildingName: "",
        street: "",
        pincode: validateString(formData?.postalCode),
        locality: {
          code:
            formData?.GeoLocationsPoint?.ward?.code ||
            formData?.SelectedBoundary?.code ||
            "",
        },
        geoLocation: validateGeoLocation({
          latitude: geoLocation.lat ?? null,
          longitude: geoLocation.lng ?? null,
        }),
      },
      additionalDetail: JSON.stringify(additionalDetail),
      auditDetails: {
        createdBy: user?.uuid,
        createdTime: timestamp,
        lastModifiedBy: user?.uuid,
        lastModifiedTime: timestamp,
      },
    },
    workflow: {
      action: "APPLY",
      verificationDocuments: Array.isArray(formData?.ComplaintImagesPoint)
        ? formData.ComplaintImagesPoint.map((image) => ({
            documentType: "PHOTO",
            fileStoreId: image,
            documentUid: "",
            additionalDetails: {},
          }))
        : [],
    },
  };
}

function isFieldValid(data: FormData, fieldKey: keyof FormData | string): boolean {
  switch (fieldKey) {
    case "ComplaintImagesPoint":
      return Array.isArray(data.ComplaintImagesPoint) && data.ComplaintImagesPoint.length > 0;
    case "SelectedBoundary": {
      const sb = data.SelectedBoundary;
      if (sb?.code) {
        // Must be a leaf (no children) — mirrors the citizen-side fix in
        // FormExplorer (egovernments/CCRS#478).
        return !Array.isArray(sb.children) || sb.children.length === 0;
      }
      return false;
    }
    case "description":
      return typeof data.description === "string" && data.description.trim().length > 0;
    case "SelectComplaintType":
      return data.SelectComplaintType != null;
    case "GeoLocationsPoint":
      return data.GeoLocationsPoint?.lat != null && data.GeoLocationsPoint?.lng != null;
    default:
      return (data as Record<string, unknown>)[fieldKey as string] != null;
  }
}

// Mandatory fields per step (zero-indexed).
const MANDATORY_BY_STEP: ReadonlyArray<ReadonlyArray<keyof FormData>> = [
  ["SelectComplaintType"], // 0 — type (sub-type is conditionally required, see stepIsValid)
  ["GeoLocationsPoint"], // 1 — map pin: lat/lng required; auto-seeded on first load so the user just confirms
  ["SelectedBoundary"], // 2 — combined location step: ward must be selected (map auto-fills it; manual fallback if auto-fill missed)
  ["description"], // 3 — description
  [], // 4 — photos (optional)
];

// ---------------------------------------------------------------------------
// Sub-step bodies
// ---------------------------------------------------------------------------

function StepShell({ title, description, children }: StepShellProps) {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2
          className="text-lg font-semibold"
          // Theme-driven heading color — picks up the tenant's primary brand
          // hue (kenya-green on naipepea, orange on default) via the same
          // var chain the legacy headings use.
          style={{
            color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
          }}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

interface StepBodyProps {
  data: FormData;
  patch: (partial: Partial<FormData>) => void;
  serviceDefs: ServiceDef[];
  hierarchyDef?: ComplaintHierarchyDef | null;
  nodes?: ClassificationNode[];
  t: (key: string) => string;
  /** Tenant the complaint will be created under. Steps that read tenant-scoped
   *  masters must use THIS, not a tenant re-derived from the session. */
  tenantId?: string;
}

/**
 * Generic, configurable N-level cascading picker driven entirely by a
 * ComplaintHierarchyDefinition + the single ComplaintHierarchy adjacency list.
 * Renders one dependent dropdown per level (the count is data, not code —
 * boundary-service style). Non-leaf options come from the interior nodes
 * (filtered by levelCode + parentCode); the single leaf level's options come
 * from the leaf rows linked to the parent strictly by parentCode. Selecting the
 * leaf hands the chosen ServiceDef-shaped row up so the existing payload/
 * validation logic is reused unchanged.
 */
function ComplaintHierarchyPicker({
  def,
  nodes,
  serviceDefs,
  onLeafChange,
  t,
}: {
  def: ComplaintHierarchyDef;
  nodes: ClassificationNode[];
  serviceDefs: ServiceDef[];
  onLeafChange: (leaf: ServiceDef | null) => void;
  t: (k: string) => string;
}) {
  const levels = React.useMemo(
    () => [...(def.levels || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [def]
  );
  const [sel, setSel] = React.useState<(string | null)[]>(() => levels.map(() => null));
  React.useEffect(() => {
    setSel((prev) => levels.map((_, i) => prev[i] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels.length]);

  const labelFor = (lvl: HierarchyLevel) =>
    tr(t, (def.hierarchyType + "_" + lvl.levelCode).toUpperCase(), lvl.label || lvl.levelCode);

  // Options for level `i` computed against an explicit selection array. Needed
  // because handleChange must know the children of a just-picked node BEFORE
  // React commits the new `sel` state (setSel is async).
  const optionsForLevelWith = (
    selArr: (string | null)[],
    i: number
  ): { value: string; label: string }[] => {
    const lvl = levels[i];
    const parentCode = i === 0 ? null : selArr[i - 1];
    if (i > 0 && !parentCode) return [];
    if (lvl.isLeafServiceCode) {
      // Leaf rows link to their parent node strictly via parentCode (single
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

  const optionsForLevel = (i: number) => optionsForLevelWith(sel, i);

  // Build a ServiceDef-shaped value from an interior node so a branch that
  // bottoms out before the declared leaf level (e.g. 3 levels declared, but
  // this SECTOR has no SUB_TYPE) can still be submitted: the deepest node the
  // user actually picked becomes the complaint's serviceCode. It is a real
  // ComplaintHierarchy row, so pgr-services accepts it (no INVALID_SERVICECODE).
  const interiorAsServiceDef = (i: number, code: string): ServiceDef | null => {
    const node = (nodes || []).find(
      (n) => n.levelCode === levels[i].levelCode && n.code === code
    );
    if (!node) return null;
    return {
      serviceCode: node.code,
      menuPath: node.parentCode ?? node.code,
      name: node.name || node.code,
      parentCode: node.parentCode ?? undefined,
      order: node.order,
    };
  };

  const handleChange = (i: number, value: string) => {
    const next = sel.slice();
    next[i] = value || null;
    for (let j = i + 1; j < next.length; j++) next[j] = null;
    setSel(next);
    if (!value) {
      onLeafChange(null);
      return;
    }
    if (levels[i].isLeafServiceCode) {
      onLeafChange((serviceDefs || []).find((s) => s.serviceCode === value) || null);
      return;
    }
    // Non-leaf selection: if a deeper level still has options, keep drilling
    // (clear any pending value). Otherwise this node is terminal — submit with
    // it as the serviceCode instead of trapping the user on an empty dropdown.
    const hasDeeper =
      i + 1 < levels.length && optionsForLevelWith(next, i + 1).length > 0;
    onLeafChange(hasDeeper ? null : interiorAsServiceDef(i, value));
  };

  // The deepest level the user has actually selected, and whether that node is
  // terminal (no children at the next level). Deeper levels are then hidden so
  // the user isn't blocked by an empty, mandatory dropdown.
  const deepestSelected = sel.reduce<number>((acc, v, idx) => (v != null ? idx : acc), -1);
  const terminalAt =
    deepestSelected >= 0 &&
    (deepestSelected + 1 >= levels.length ||
      optionsForLevelWith(sel, deepestSelected + 1).length === 0)
      ? deepestSelected
      : -1;

  return (
    <div className="space-y-5">
      {levels.map((lvl, i) => {
        // Once the chosen branch terminates early, drop the deeper levels that
        // have nothing to offer (e.g. SUB_TYPE under a SECTOR that has none).
        if (terminalAt >= 0 && i > terminalAt) return null;
        const disabled = i > 0 && !sel[i - 1];
        const opts = optionsForLevel(i);
        return (
          <Field
            key={lvl.levelCode}
            label={labelFor(lvl)}
            required={opts.length > 0}
            htmlFor={`lvl-${i}`}
          >
            <Select
              id={`lvl-${i}`}
              value={sel[i] ?? undefined}
              disabled={disabled}
              onValueChange={(value: string) => handleChange(i, value)}
              placeholder={
                disabled
                  ? tr(t, "CS_COMPLAINT_PICK_PARENT_FIRST", "Select the level above first")
                  : tr(t, "CS_COMPLAINT_PICK_ONE", "Select…")
              }
              options={opts}
            />
          </Field>
        );
      })}
    </div>
  );
}

function Step0Type({ data, patch, serviceDefs, hierarchyDef, nodes, t }: StepBodyProps) {
  const hierarchyActive = !!(
    hierarchyDef &&
    Array.isArray(hierarchyDef.levels) &&
    hierarchyDef.levels.length > 0
  );

  // Unique main types by menuPath
  const types = React.useMemo(() => {
    const seen = new Set<string>();
    return serviceDefs
      .filter((s) => {
        if (!s.menuPath || seen.has(s.menuPath)) return false;
        seen.add(s.menuPath);
        return true;
      })
      .map((s) => ({
        ...s,
        // Group label = key-based (COMPLAINT_HIERARCHY.<parentCode>) with the
        // parent node name as fallback.
        menuPathName: complaintLabel(t, s.menuPath, s.menuPathName),
      }));
  }, [serviceDefs, t]);

  const subTypes = React.useMemo(() => {
    const mp = data.SelectComplaintType?.menuPath;
    if (!mp) return [];
    return serviceDefs
      .filter((s) => s.menuPath === mp)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [data.SelectComplaintType?.menuPath, serviceDefs]);

  return (
    <StepShell title={t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}>
      <div className="space-y-5">
        {hierarchyActive ? (
          <ComplaintHierarchyPicker
            def={hierarchyDef as ComplaintHierarchyDef}
            nodes={nodes || []}
            serviceDefs={serviceDefs}
            t={t}
            onLeafChange={(leaf) =>
              patch({ SelectComplaintType: leaf, SelectSubComplaintType: leaf })
            }
          />
        ) : (
          <>
        <Field
          label={t("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE")}
          required
          htmlFor="complaint-type"
        >
          <Select
            id="complaint-type"
            value={data.SelectComplaintType?.menuPath}
            onValueChange={(value: string) => {
              const picked = types.find((tp) => tp.menuPath === value);
              patch({ SelectComplaintType: picked, SelectSubComplaintType: null });
            }}
            placeholder={tr(t, "CS_COMPLAINT_PICK_TYPE", "Select a complaint type")}
            options={types.map((tp) => ({
              value: tp.menuPath,
              label: tp.menuPathName ?? tp.menuPath,
            }))}
          />
        </Field>
        {subTypes.length > 1 ? (
          <Field
            label={t("CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE")}
            required
            htmlFor="complaint-subtype"
          >
            <Select
              id="complaint-subtype"
              value={data.SelectSubComplaintType?.serviceCode}
              onValueChange={(value: string) => {
                const picked = subTypes.find((s) => s.serviceCode === value);
                patch({ SelectSubComplaintType: picked });
              }}
              placeholder={tr(t, "CS_COMPLAINT_PICK_SUBTYPE", "Select a subtype")}
              options={subTypes.map((s) => ({
                value: s.serviceCode,
                label: complaintLabel(t, s.serviceCode, s.name),
              }))}
            />
          </Field>
        ) : null}
          </>
        )}
      </div>
    </StepShell>
  );
}

function Step1Map({ data, patch, t }: StepBodyProps) {
  // Reuse the existing GeoLocations component — it owns the leaflet map +
  // Nominatim integration. We just pass through formData and a setter.
  const GeoLocations = Digit?.ComponentRegistryService?.getComponent("GeoLocations");
  if (!GeoLocations) {
    return (
      <StepShell title={t("CS_ADDCOMPLAINT_SELECT_GEOLOCATION_HEADER")}>
        <p className="text-sm text-destructive">Map component not registered.</p>
      </StepShell>
    );
  }
  return (
    <StepShell
      title={t("CS_ADDCOMPLAINT_SELECT_GEOLOCATION_HEADER")}
      description={tr(
        t,
        "CS_PIN_LOCATION_HINT",
        "Drop a pin on the exact spot — we'll use it to route your complaint to the right ward."
      )}
    >
      <GeoLocations
        t={t}
        config={{
          key: "GeoLocationsPoint",
          populators: { name: "GeoLocationsPoint" },
          withoutLabel: true,
        }}
        formData={data}
        onSelect={(_key: string, value: GeoPoint) => {
          patch({
            GeoLocationsPoint: value,
            // Mirror the new pin's pincode onto postalCode. Always reset to the
            // current pin: if the newly-picked location has no pincode, clear it
            // rather than keeping the previous pin's value — otherwise a stale
            // pincode from an earlier pin lingers after the pin is moved
            // (CCRS#722). The user can still type one on the location step.
            postalCode:
              value?.pincode != null && String(value.pincode).length > 0
                ? String(value.pincode)
                : "",
          });
        }}
      />
    </StepShell>
  );
}

/**
 * Combined location-confirmation step.
 *
 * Replaces the separate address (landmark + postal code) and ward
 * (County / Sub-County / Ward cascade) steps. The previous flow asked
 * the user to re-pick all three boundary levels and re-type the
 * pincode even though the prior map step had already captured them
 * via `GeoLocations.resolveWard()` (point-in-polygon on the bundled
 * Nairobi-wards GeoJSON, plus Nominatim for pincode).
 *
 * Now: the boundary cascade auto-fills from the map pin and renders
 * each level as DISABLED Selects (read-only with the value visible),
 * pincode is the same kind of disabled input, and the user only
 * types an optional landmark before continuing. If the auto-fill
 * misses a particular level (GeoJSON / boundary-tree drift, or
 * pincode missing from Nominatim) the affected control becomes
 * interactive so the user can fill the gap manually.
 */
function Step2Location({ data, patch, t, tenantId }: StepBodyProps) {
  const PGRBoundaryComponent = Digit?.ComponentRegistryService?.getComponent("PGRBoundaryComponent");

  // The map's resolveWard writes ward.{code, name} into
  // GeoLocationsPoint when the pin lands inside a known ward polygon.
  // BoundaryComponent watches that field and rebuilds its cascade
  // path; we use the same hint to decide whether to mark the cascade
  // read-only.
  const wardHint = data?.GeoLocationsPoint?.ward;
  const wardFromMap = !!(wardHint?.code || wardHint?.name);

  // The pincode pre-fills from the map pin (Nominatim) but stays EDITABLE —
  // the reverse-geocode is frequently wrong or the wrong length, so the user
  // must always be able to correct it (CCRS#722). It used to be disabled
  // whenever the map produced a value, which locked in bad pincodes.
  const pincodeFromMap = data?.GeoLocationsPoint?.pincode;
  // What's actually shown/submitted: a manual entry (data.postalCode) wins over
  // the map-derived value.
  const effectivePincode = data.postalCode ?? (pincodeFromMap != null ? String(pincodeFromMap) : "");
  const postalValid = isPostalCodeValid(effectivePincode);
  const showPostalError = effectivePincode.length > 0 && !postalValid;

  return (
    <StepShell
      title={t("CS_COMPLAINT_LOCATION_DETAILS") || "Confirm location"}
      description={tr(
        t,
        "CS_LOCATION_CONFIRM_HINT",
        "We picked these from your map pin. Add a landmark if it helps the team find the spot."
      )}
    >
      <div className="space-y-5">
        {PGRBoundaryComponent ? (
          <PGRBoundaryComponent
            t={t}
            userType="citizen"
            // Scope the cascade to the tenant the complaint FILES under, which is
            // the same tenant the map resolves against. Without it the cascade
            // falls back to ULBService.getCurrentTenantId(), which returns
            // STATE_LEVEL_TENANT_ID for every citizen — so a citizen whose home
            // city is set would pick boundaries out of the state root's tree and
            // attach them to a complaint filed in their city.
            config={{ key: "SelectedBoundary", populators: { name: "SelectedBoundary" }, label: "", tenantId }}
            formData={data}
            // Ask the cascade to render its dropdowns as disabled
            // wherever it has an auto-filled value. Levels left empty
            // (auto-fill miss) stay interactive so the user can pick.
            readOnly={wardFromMap}
            onSelect={(_key: string, value: BoundaryNode) => {
              patch({ SelectedBoundary: value });
            }}
          />
        ) : (
          <p className="text-sm text-destructive">Boundary component not registered.</p>
        )}

        <Field
          label={t("CS_COMPLAINT_POSTALCODE__DETAILS")}
          htmlFor="postal-code"
          error={showPostalError ? postalErrorText(t) : undefined}
        >
          <Input
            id="postal-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={7}
            invalid={showPostalError}
            value={effectivePincode}
            onChange={(e) => patch({ postalCode: e.target.value.replace(/\D/g, "") })}
          />
        </Field>

        <Field label={t("CS_COMPLAINT_LANDMARK__DETAILS")} htmlFor="landmark">
          <Input
            id="landmark"
            placeholder={tr(t, "CS_LANDMARK_PLACEHOLDER", "e.g. Near Jamia Mosque")}
            maxLength={64}
            value={data.landmark ?? ""}
            onChange={(e) => patch({ landmark: e.target.value })}
          />
        </Field>
      </div>
    </StepShell>
  );
}

function Step3Description({ data, patch, t }: StepBodyProps) {
  return (
    <StepShell
      title={t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS")}
      description={tr(
        t,
        "CS_DESCRIPTION_HINT",
        "What happened? When did it start? Add as much detail as helps."
      )}
    >
      <Field
        label={t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION")}
        required
        htmlFor="complaint-description"
      >
        <Textarea
          id="complaint-description"
          placeholder={tr(
            t,
            "CS_DESCRIBE_THE_ISSUE_PLACEHOLDER",
            "Describe the issue in your own words…"
          )}
          maxLength={1000}
          value={data.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <div className="mt-1 text-xs text-muted-foreground text-right">
          {(data.description ?? "").length} / 1000
        </div>
      </Field>
    </StepShell>
  );
}

function Step4Images({ data, patch, t }: StepBodyProps) {
  // Reuse SelectImages — the registered component knows how to call the
  // upload API and write fileStoreIds back. We pass formData + setter the
  // same way it expects from FormStep.
  const SelectImages = Digit?.ComponentRegistryService?.getComponent("SelectImages");
  if (!SelectImages) {
    return (
      <StepShell title={t("CS_ADDCOMPLAINT_UPLOAD_PHOTO")}>
        <p className="text-sm text-destructive">Image-upload component not registered.</p>
      </StepShell>
    );
  }
  return (
    <StepShell title={t("CS_ADDCOMPLAINT_UPLOAD_PHOTO")}>
      <SelectImages
        t={t}
        formData={data}
        onSelect={(_key: string, value: string[]) => {
          patch({ ComplaintImagesPoint: value });
        }}
        config={{
          key: "ComplaintImagesPoint",
          populators: { name: "ComplaintImagesPoint" },
          label: "CS_ADDCOMPLAINT_UPLOAD_PHOTO_TEXT",
        }}
      />
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const CreatePGRFlowV2: React.FC = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const dispatch = useDispatch();
  const client = useQueryClient();

  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const tenants: any = Digit.Hooks.pgr.useTenants();

  // The single RAINMAKER-PGR.ComplaintHierarchy adjacency list (interior nodes
  // + leaf complaint types) is the only complaint-type master now. We derive:
  //   - serviceDefs: leaf rows mapped to the legacy shape (serviceCode=code,
  //     menuPath=parentCode) so the flat fallback picker keeps working verbatim;
  //   - hierData.nodes: the full row set the N-level cascade picker walks.
  // Absent definition => the flat menuPath (=parentCode) picker is used.
  const { data: hierAll, isLoading: isMDMSLoading } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw: any) => {
        const allDefs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter(
          (d: any) => d?.active !== false
        );
        const allRows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        // Prefer a definition that actually HAS rows — guards against a
        // stray/empty definition being picked first. Scope rows to its type.
        const def =
          allDefs.find((d: any) => allRows.some((n: any) => n?.hierarchyType === d?.hierarchyType)) ||
          allDefs[0] ||
          null;
        const rows = def
          ? allRows.filter((n: any) => n?.hierarchyType === def.hierarchyType)
          : allRows;
        const isLeaf = (n: any) => n?.department != null || n?.slaHours != null;
        const nodes = (rows || []).filter((n: any) => !isLeaf(n));
        const serviceDefs = (rows || [])
          .filter((n: any) => isLeaf(n) && n.active !== false)
          .map((n: any) => ({ ...n, serviceCode: n.code, menuPath: n.parentCode }));
        return { def, nodes, serviceDefs };
      },
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY" }
  );

  const serviceDefs = hierAll?.serviceDefs;
  const hierData = hierAll ? { def: hierAll.def, nodes: hierAll.nodes } : undefined;

  const { mutate: createMutation } = Digit.Hooks.pgr.useCreateComplaint(tenantId);

  const [stepIndex, setStepIndex] = React.useState(0);
  const [formData, setFormData] = React.useState<FormData>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const patch = React.useCallback((partial: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
    if (error) setError(null);
  }, [error]);

  const isLast = stepIndex === STEPS.length - 1;

  // Seed postalCode from the map pin's pincode, but ONLY when the pin's pincode
  // actually changes — never on a postalCode edit. The previous version listed
  // `formData.postalCode` as a dependency and forced it back to the map value,
  // so the auto-filled field reverted on every keystroke and was effectively
  // un-editable (CCRS#722). A ref tracking the last map pincode lets the user
  // freely correct the auto-filled value; a pin move still resets it (and
  // clears it when the new pin has no pincode, rather than keeping a stale one).
  const lastMapPincodeRef = React.useRef<string | undefined>(
    formData?.GeoLocationsPoint?.pincode != null && String(formData.GeoLocationsPoint.pincode).length > 0
      ? String(formData.GeoLocationsPoint.pincode)
      : undefined
  );
  React.useEffect(() => {
    const pin = formData?.GeoLocationsPoint?.pincode;
    const mapPin = pin != null && String(pin).length > 0 ? String(pin) : undefined;
    if (mapPin !== lastMapPincodeRef.current) {
      lastMapPincodeRef.current = mapPin;
      setFormData((prev) => ({ ...prev, postalCode: mapPin ?? "" }));
    }
    // Intentionally excludes formData.postalCode — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData?.GeoLocationsPoint?.pincode]);

  const stepIsValid = React.useMemo(() => {
    const required = MANDATORY_BY_STEP[stepIndex] || [];
    if (!required.every((field) => isFieldValid(formData, field))) return false;
    // Sub-type is conditionally mandatory: if the chosen complaint type has
    // any sub-services in the same menuPath, the user MUST pick one before
    // continuing. Mirrors the legacy FormExplorer (which surfaced the
    // dropdown only when sub-types existed and required a selection); the
    // baseline MANDATORY_BY_STEP can't express this since the requirement
    // depends on serviceDefs, not on a fixed field list.
    if (stepIndex === 0) {
      const mainPath = formData.SelectComplaintType?.menuPath;
      const subTypeOptions = (Array.isArray(serviceDefs) ? serviceDefs : []).filter(
        (s: ServiceDef) => s.menuPath === mainPath
      );
      if (subTypeOptions.length > 1 && !formData.SelectSubComplaintType) {
        return false;
      }
    }
    // Location step: don't let the user past a pincode that doesn't match the
    // tenant's configured length (CCRS#722). Empty is allowed (optional); an
    // invalid map-autofilled value must be corrected before continuing.
    if (stepIndex === 2) {
      const effective = formData.postalCode ?? formData?.GeoLocationsPoint?.pincode;
      if (!isPostalCodeValid(effective)) return false;
    }
    return true;
  }, [stepIndex, formData, serviceDefs]);

  function pincodeAllowlistOk(): boolean {
    const wardResolved =
      !!formData?.GeoLocationsPoint?.ward?.code || !!formData?.SelectedBoundary?.code;
    if (wardResolved) return true; // ward routing supersedes pincode allowlist (CCRS#469)
    if (!formData.postalCode || String(formData.postalCode).length === 0) return true;
    const norm = (v: unknown) => String(v ?? "").trim().replace(/^0+/, "") || "0";
    const list = norm(formData.postalCode);
    const configured =
      Array.isArray(tenants) &&
      tenants.some((tnt: any) => Array.isArray(tnt?.pincode) && tnt.pincode.length > 0);
    if (!configured) return true;
    return tenants.some(
      (tnt: any) =>
        Array.isArray(tnt?.pincode) &&
        tnt.pincode.some((p: unknown) => norm(p) === list)
    );
  }

  function handleContinue() {
    if (!stepIsValid) {
      setError(t("CORE_COMMON_REQUIRED_ERRMSG"));
      return;
    }
    if (isLast) {
      if (!pincodeAllowlistOk()) {
        setError(t("CS_COMMON_PINCODE_NOT_SERVICABLE"));
        return;
      }
      setSubmitting(true);
      const user = Digit.UserService.getUser();
      const payload = mapFormDataToRequest(formData, tenantId, user?.info ?? user);
      createMutation(payload, {
        onError: () => {
          dispatch({ type: "CREATE_COMPLAINT", payload: { responseInfo: { status: "failed" } } });
          setSubmitting(false);
          history.push(`/digit-ui/citizen/pgr/response`);
        },
        onSuccess: async (responseData: any) => {
          dispatch({ type: "CREATE_COMPLAINT", payload: responseData });
          await client.refetchQueries(["complaintsList"]);
          setSubmitting(false);
          history.push(`/digit-ui/citizen/pgr/response`);
        },
      });
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function handleBack() {
    if (stepIndex === 0) {
      history.goBack();
      return;
    }
    setStepIndex((i) => i - 1);
  }

  if (isMDMSLoading) {
    // Spinner is parked dead-centre of the form column. ScreenContainer is
    // a flex column filling the wrapper; we make the spinner row a flex
    // child that grows (`flex: 1`) and centres its inline-block spinner
    // both axes — so loading state covers the same available area the
    // form occupies (between topbar and page-footer), no off-axis drift.
    return (
      <ScreenContainer>
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          <span
            aria-label="Loading"
            style={{
              display: "inline-block",
              height: "2rem",
              width: "2rem",
              border: "3px solid currentColor",
              borderTopColor: "transparent",
              borderRadius: "9999px",
              color:
                "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      </ScreenContainer>
    );
  }

  const stepProps: StepBodyProps = {
    data: formData,
    patch,
    serviceDefs: Array.isArray(serviceDefs) ? serviceDefs : [],
    hierarchyDef: hierData?.def ?? null,
    nodes: hierData?.nodes ?? [],
    t,
    tenantId,
  };

  return (
    <ScreenContainer>
      <div style={{ padding: "0.75rem 1.25rem 0 1.25rem", flexShrink: 0 }}>
        <ScreenHeader
          title={tr(t, "CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
        />
      </div>
      {/* Step body — sits between the header and the FormFooter and
          flows at content height. The earlier body-only-scroll
          variant (`overflow-y: auto` here) clipped dropdown listboxes
          when a Type/Subtype/Boundary popover wanted to extend past
          the form bottom on a short form, forcing an internal scroll
          inside the body instead of letting the popover float over
          adjacent surface. With overflow visible the popover spills
          out cleanly; the wrapper still has min-width:0 + flex 1
          for citizen layout reasons. */}
      <div
        style={{
          flex: "1 1 auto",
          // Same horizontal rhythm as the other v2 surfaces (My
          // Complaints, Edit Profile, etc.) — without it, on mobile
          // the Card kissed the viewport edges left/right with zero
          // breathing room, since the parent .pgr-citizen-wrapper
          // sets no inline padding either.
          padding: "1rem 1.25rem",
        }}
      >
        {stepIndex === 0 && <Step0Type {...stepProps} />}
        {stepIndex === 1 && <Step1Map {...stepProps} />}
        {stepIndex === 2 && <Step2Location {...stepProps} />}
        {stepIndex === 3 && <Step3Description {...stepProps} />}
        {stepIndex === 4 && <Step4Images {...stepProps} />}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>
      <FormFooter>
        <Button variant="outline" onClick={handleBack} type="button">
          {stepIndex === 0 ? tr(t, "CS_COMMON_CANCEL", "Cancel") : t("BACK")}
        </Button>
        <Button
          variant="primary"
          onClick={handleContinue}
          loading={submitting}
          disabled={!stepIsValid}
          type="button"
        >
          {isLast ? t("SUBMIT") : t("NEXT")}
        </Button>
      </FormFooter>
    </ScreenContainer>
  );
};

export default CreatePGRFlowV2;
