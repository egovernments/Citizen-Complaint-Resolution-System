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
  // Authority dispatcher + dynamic "additional details" (Mozambique IGE/IGSAE).
  // Populated only when RAINMAKER-PGR.ComplaintRelatedToMap is seeded; absent
  // otherwise so the legacy flow is byte-identical.
  relatedTo?: string;
  templateType?: string;
  resolvedTenantId?: string;
  dynamicFields?: Record<string, unknown>;
  consents?: string[];
  prefersConfidentiality?: boolean;
}

// RAINMAKER-PGR.ComplaintRelatedToMap — the citizen-facing dispatcher. Maps a
// natural-language option → templateType + the sub-tenant the complaint is filed
// under. State-level master.
interface RelatedToOption {
  relatedTo: string;
  templateType: string;
  tenantId: string;
  order?: number;
  active?: boolean;
}

// RAINMAKER-PGR.ComplaintTemplateType.fields[] — the dynamic detail fields,
// keyed by templateType. State-level master.
interface TemplateField {
  fieldKey: string;
  label: string;
  dataType?: string; // string | textarea | date | number | boolean
  mandatory?: boolean;
  maxLength?: number;
  order?: number;
  // Confidentiality classification — needs BACKEND enforcement (encryption /
  // masking). FE+MDMS-only build excludes flagged fields (fail-closed).
  pii?: boolean;
  maskable?: boolean;
  encrypted?: boolean;
}

function isProtectedField(f: TemplateField): boolean {
  return f.pii === true || f.encrypted === true || f.maskable === true;
}

// Complaint-level declarations confirmed before submit (BRD).
const REQUIRED_CONSENTS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "TRUTHFULNESS", label: "I declare that the information provided is true and accurate." },
  { code: "DATA_PROCESSING", label: "I consent to my data being processed to handle this complaint." },
];

// Consistent checkbox styling: fixed-size box with a theme-accent (centered native
// tick), nudged to align with the first line of the label text.
const CHECKBOX_STYLE: React.CSSProperties = {
  width: "1rem",
  height: "1rem",
  marginTop: "0.15rem",
  flexShrink: 0,
  accentColor: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
  cursor: "pointer",
};

interface StepShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

// Consolidated 3-step wizard (was 6 screens). Each step groups what used to be
// separate screens so the citizen reaches Submit in far fewer taps:
//   complaint — "what is it about?" (related-to dispatcher) + the complaint type
//   where     — map pin + ward (auto-cascaded from the pin) + landmark/postal
//   details   — description + dynamic category fields + photos + consents → submit
const STEPS = [
  { id: "complaint", title: "Complaint" },
  { id: "where", title: "Location" },
  { id: "details", title: "Details" },
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
  // extendedAttributes (templateType, prefersConfidentiality, consents, fields)
  // ride inside the EXISTING additionalDetail — there is no top-level
  // service.extendedAttributes column in this build (that is the backend phase).
  // Added only when an authority/templateType was resolved (legacy flow unchanged).
  const additionalDetail: Record<string, unknown> = {};
  if (formData?.templateType) {
    additionalDetail.extendedAttributes = {
      templateType: formData.templateType,
      prefersConfidentiality: !!formData.prefersConfidentiality,
      consents: formData.consents || [],
      schemaVersion: "1.0",
      fields: { ...(formData.dynamicFields || {}) },
    };
  }
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

// (Per-step mandatory map removed — step validation is keyed by step id in
// stepIsValid now that steps are consolidated.)

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
  // Authority dispatcher + dynamic-detail props (present only in the
  // ComplaintRelatedToMap-seeded flow).
  relatedToOptions?: RelatedToOption[];
  templateFields?: TemplateField[];
  suppressedCount?: number;
  // The authority-resolved tenant — scopes the boundary cascade (and anything
  // else tenant-specific) to the picked institution, not the login tenant.
  resolvedTenant?: string;
  // Inline loading flags for the consolidated "complaint" step (so we render a
  // small spinner in-place instead of blanking the whole screen).
  catalogueLoading?: boolean;
  dispatcherLoading?: boolean;
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

// ── Authority / "Complaint related to" — dispatcher step ──────────────────
// Renders only when RAINMAKER-PGR.ComplaintRelatedToMap is seeded. The pick
// resolves a templateType + the sub-tenant the complaint is filed under (the
// catalogue is then fetched at that tenant; tenant code is never shown).
function RelatedToStepBody({ data, patch, relatedToOptions, t }: StepBodyProps) {
  const options = relatedToOptions || [];
  return (
    <StepShell title={tr(t, "CS_COMPLAINT_RELATED_TO", "What is your complaint about?")}>
      <Field
        label={tr(t, "CS_COMPLAINT_RELATED_TO_FIELD", "Complaint related to")}
        required
        htmlFor="related-to"
      >
        <Select
          id="related-to"
          value={data.relatedTo}
          onValueChange={(value: string) => {
            const o = options.find((x) => x.relatedTo === value);
            if (!o) return;
            patch({
              relatedTo: o.relatedTo,
              templateType: o.templateType,
              resolvedTenantId: o.tenantId,
              // Authority drives the catalogue + fields — reset downstream.
              SelectComplaintType: null,
              SelectSubComplaintType: null,
              dynamicFields: {},
            });
          }}
          placeholder={tr(t, "CS_COMPLAINT_PICK_ONE", "Select…")}
          options={options.map((o) => ({ value: o.relatedTo, label: o.relatedTo }))}
        />
      </Field>
    </StepShell>
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

// ── Section header (title + subtitle) for the unified "Where" card ──
const TipBulbIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
  </svg>
);
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0, color: PRIMARY }}>{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

function Step1Map({ data, patch, t }: StepBodyProps) {
  // Reuse the existing GeoLocations component (leaflet + Nominatim). Rendered
  // BARE (no card) — it sits in the left pane of the unified "Where" card.
  const GeoLocations = Digit?.ComponentRegistryService?.getComponent("GeoLocations");
  return (
    <div>
      <SectionHeader
        title={tr(t, "CS_PIN_LOCATION_TITLE", "Pin the complaint location")}
        subtitle={tr(t, "CS_PIN_LOCATION_HINT", "Click and hold on the map to drop the pin on the exact spot.")}
      />
      {GeoLocations ? (
        <GeoLocations
          t={t}
          config={{
            key: "GeoLocationsPoint",
            populators: { name: "GeoLocationsPoint" },
            withoutLabel: true,
            // Map height tuned to balance the Location-details pane once the mz
            // boundary cascade is expanded (Província → Distrito → Município +
            // postal + landmark + tip ≈ this tall). Citizen flow only; the shared
            // component otherwise fills calc(100vh-400px).
            mapHeight: "520px",
          }}
          formData={data}
          onSelect={(_key: string, value: GeoPoint) => {
            patch({
              GeoLocationsPoint: value,
              // Mirror the pin's pincode onto postalCode (matches FormExplorer).
              postalCode:
                value?.pincode != null && String(value.pincode).length > 0
                  ? String(value.pincode)
                  : data.postalCode,
            });
          }}
        />
      ) : (
        <p className="text-sm text-destructive">Map component not registered.</p>
      )}
    </div>
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
function Step2Location({ data, patch, resolvedTenant, t }: StepBodyProps) {
  const PGRBoundaryComponent = Digit?.ComponentRegistryService?.getComponent("PGRBoundaryComponent");

  // The map's resolveWard writes ward.{code, name} into
  // GeoLocationsPoint when the pin lands inside a known ward polygon.
  // BoundaryComponent watches that field and rebuilds its cascade
  // path; we use the same hint to decide whether to mark the cascade
  // read-only.
  const wardHint = data?.GeoLocationsPoint?.ward;
  const wardFromMap = !!(wardHint?.code || wardHint?.name);

  // Pincode is read-only if it came from the map (Nominatim). If the
  // map didn't return one, postalCode is empty / undefined and the
  // user gets a normal editable field. Manual input must NOT feed back
  // into this flag: gating on data.postalCode disabled the field after
  // the first typed character.
  const pincodeFromMap = data?.GeoLocationsPoint?.pincode;
  const pincodeKnown =
    !!(pincodeFromMap != null && String(pincodeFromMap).length > 0);

  return (
    <div>
      <SectionHeader
        title={tr(t, "CS_LOCATION_DETAILS_TITLE", "Location details")}
        subtitle={tr(t, "CS_LOCATION_CONFIRM_HINT", "Add details so our team can quickly find the exact spot.")}
      />
      <div className="space-y-5">
        {PGRBoundaryComponent ? (
          <PGRBoundaryComponent
            t={t}
            userType="citizen"
            config={{ key: "SelectedBoundary", populators: { name: "SelectedBoundary" }, label: "", tenantId: resolvedTenant }}
            formData={data}
            // Disable cascade levels that auto-filled; empty (auto-fill miss)
            // levels stay interactive so the user can pick manually.
            readOnly={wardFromMap}
            onSelect={(_key: string, value: BoundaryNode) => {
              patch({ SelectedBoundary: value });
            }}
          />
        ) : (
          <p className="text-sm text-destructive">Boundary component not registered.</p>
        )}

        <Field label={t("CS_COMPLAINT_POSTALCODE__DETAILS")} htmlFor="postal-code">
          <Input
            id="postal-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={7}
            disabled={pincodeKnown}
            value={data.postalCode ?? (pincodeFromMap != null ? String(pincodeFromMap) : "")}
            onChange={(e) => patch({ postalCode: e.target.value.replace(/\D/g, "") })}
          />
        </Field>

        <Field
          label={tr(t, "CS_COMPLAINT_LANDMARK__DETAILS", "Landmark") + " " + tr(t, "CS_OPTIONAL_SUFFIX", "(Optional)")}
          htmlFor="landmark"
        >
          <Input
            id="landmark"
            placeholder={tr(t, "CS_LANDMARK_PLACEHOLDER", "e.g. Near Jamia Mosque, Next to Central Market")}
            maxLength={64}
            value={data.landmark ?? ""}
            onChange={(e) => patch({ landmark: e.target.value })}
          />
        </Field>

        {/* Tip callout — encourages a landmark for faster routing. */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
            background: "#edf6ef",
            border: "1px solid #cfe6d6",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
          }}
        >
          <span style={{ color: PRIMARY, flexShrink: 0, marginTop: "1px", display: "inline-flex" }}>{TipBulbIcon}</span>
          <div className="text-sm">
            <div className="font-medium" style={{ color: PRIMARY }}>{tr(t, "CS_LOCATION_TIP_TITLE", "Tip")}</div>
            <div className="text-muted-foreground">
              {tr(t, "CS_LOCATION_TIP_BODY", "A landmark helps our team find the exact spot faster.")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step3Description({ data, patch, templateFields, suppressedCount, t }: StepBodyProps) {
  const fields = templateFields || [];
  const dyn = data.dynamicFields || {};
  const consents = data.consents || [];
  const extended = !!data.templateType; // dispatcher flow active
  const setDyn = (key: string, value: unknown) => patch({ dynamicFields: { ...dyn, [key]: value } });
  const toggleConsent = (code: string, on: boolean) =>
    patch({ consents: on ? [...consents, code] : consents.filter((c) => c !== code) });

  return (
    <StepShell
      title={t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS")}
      description={tr(
        t,
        "CS_DESCRIPTION_HINT",
        "What happened? When did it start? Add as much detail as helps."
      )}
    >
      <div className="space-y-5">
        <Field
          label={t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION")}
          required
          htmlFor="complaint-description"
        >
          <Textarea
            id="complaint-description"
            placeholder={tr(t, "CS_DESCRIBE_THE_ISSUE_PLACEHOLDER", "Describe the issue in your own words…")}
            maxLength={1000}
            value={data.description ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
          />
          <div className="mt-1 text-xs text-muted-foreground text-right">
            {(data.description ?? "").length} / 1000
          </div>
        </Field>

        {/* Dynamic fields from RAINMAKER-PGR.ComplaintTemplateType[templateType]. */}
        {fields.map((f) => {
          const val = (dyn[f.fieldKey] as string) ?? "";
          return (
            <Field key={f.fieldKey} label={f.label} required={!!f.mandatory} htmlFor={`xf-${f.fieldKey}`}>
              {f.dataType === "textarea" ? (
                <Textarea
                  id={`xf-${f.fieldKey}`}
                  maxLength={f.maxLength}
                  value={val}
                  onChange={(e) => setDyn(f.fieldKey, e.target.value)}
                />
              ) : (
                <Input
                  id={`xf-${f.fieldKey}`}
                  type={f.dataType === "date" ? "date" : f.dataType === "number" ? "number" : "text"}
                  maxLength={f.dataType === "date" || f.dataType === "number" ? undefined : f.maxLength}
                  value={val}
                  onChange={(e) => setDyn(f.fieldKey, e.target.value)}
                />
              )}
            </Field>
          );
        })}

        {suppressedCount ? (
          <p className="text-xs text-muted-foreground">
            {suppressedCount} sensitive field{suppressedCount === 1 ? "" : "s"} (personal/encrypted) are not collected
            here — they require secure handling planned for a later phase.
          </p>
        ) : null}

        {extended ? (
          <div className="space-y-2">
            {REQUIRED_CONSENTS.map((c) => (
              <label key={c.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  style={CHECKBOX_STYLE}
                  checked={consents.includes(c.code)}
                  onChange={(e) => toggleConsent(c.code, e.target.checked)}
                />
                <span>{c.label}</span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-sm pt-2 border-t border-border">
              <input
                type="checkbox"
                style={CHECKBOX_STYLE}
                checked={!!data.prefersConfidentiality}
                onChange={(e) => patch({ prefersConfidentiality: e.target.checked })}
              />
              <span>
                Mark this complaint as sensitive.{" "}
                <span className="text-muted-foreground">
                  This flags it for staff awareness; it does not yet hide or restrict who can view it.
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </div>
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
// Composite steps (3-step wizard) — each groups the sub-bodies above so the
// citizen completes the flow in 3 screens instead of 6. The sub-bodies keep
// their own logic untouched; we just render them together.
// ---------------------------------------------------------------------------

const PRIMARY = "var(--color-primary-1, var(--color-primary-main, #c84c0e))";

function InlineSpinner() {
  return (
    <Card className="p-6">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 0" }}>
        <span
          aria-label="Loading"
          style={{
            display: "inline-block",
            height: "1.75rem",
            width: "1.75rem",
            border: "3px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "9999px",
            color: PRIMARY,
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    </Card>
  );
}

// Step 1 — "Your complaint": the related-to dispatcher (when seeded) followed,
// progressively, by the complaint-type picker for the resolved sub-tenant. The
// type section appears only once an authority is chosen, and shows an inline
// spinner while that tenant's catalogue loads (no full-page blank).
function StepComplaint(props: StepBodyProps) {
  const { data, relatedToOptions, catalogueLoading, dispatcherLoading } = props;
  const hasDispatcher = (relatedToOptions?.length ?? 0) > 0;
  if (dispatcherLoading) return <InlineSpinner />;
  const showType = !hasDispatcher || !!data.relatedTo;
  return (
    <div className="space-y-5">
      {hasDispatcher ? <RelatedToStepBody {...props} /> : null}
      {showType ? (catalogueLoading ? <InlineSpinner /> : <Step0Type {...props} />) : null}
    </div>
  );
}

// Step 2 — "Where": ONE unified card with the map (left, larger) and Location
// details (right). flex-wrap stacks them on mobile (no Tailwind md: needed).
// align-items:flex-start keeps the form pinned top-right beside the capped map.
function StepWhere(props: StepBodyProps) {
  return (
    <Card className="p-6">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-start" }}>
        <div style={{ flex: "3 1 420px", minWidth: 0 }}>
          <Step1Map {...props} />
        </div>
        <div style={{ flex: "2 1 300px", minWidth: 0 }}>
          <Step2Location {...props} />
        </div>
      </div>
    </Card>
  );
}

// Step 3 — "Details": description + dynamic category fields + consents + photos.
function StepDetails(props: StepBodyProps) {
  return (
    <div className="space-y-5">
      <Step3Description {...props} />
      <Step4Images {...props} />
    </div>
  );
}

// Lightweight 3-segment progress indicator (numbered, current highlighted).
function WizardProgress({
  steps,
  current,
  t,
}: {
  steps: ReadonlyArray<{ id: string; title: string }>;
  current: number;
  t: (k: string) => string;
}) {
  return (
    <div className="flex items-center gap-2" style={{ marginTop: "0.75rem" }}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const filled = done || active;
        return (
          <React.Fragment key={s.id}>
            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
              <span
                aria-current={active ? "step" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "1.5rem",
                  width: "1.5rem",
                  borderRadius: "9999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  flexShrink: 0,
                  color: filled ? "#fff" : "var(--color-text-secondary, #64748b)",
                  background: filled ? PRIMARY : "transparent",
                  border: filled
                    ? "1px solid " + PRIMARY
                    : "1px solid var(--color-border, #cbd5e1)",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className="text-sm"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: active ? 600 : 400,
                  color: active ? PRIMARY : "var(--color-text-secondary, #64748b)",
                }}
              >
                {tr(t, "CS_CREATE_STEP_" + s.id.toUpperCase(), s.title)}
              </span>
            </div>
            {i < steps.length - 1 ? (
              <div
                style={{
                  flex: "1 1 auto",
                  height: "1px",
                  minWidth: "0.75rem",
                  background: "var(--color-border, #cbd5e1)",
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
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

  const baseTenant =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const stateTenant =
    Digit.ULBService.getStateId() ||
    (baseTenant ? String(baseTenant).split(".")[0] : baseTenant);
  const tenants: any = Digit.Hooks.pgr.useTenants();

  const [stepIndex, setStepIndex] = React.useState(0);
  const [formData, setFormData] = React.useState<FormData>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Authority dispatcher (RAINMAKER-PGR.ComplaintRelatedToMap @ state tenant).
  // Empty (the default for any tenant that hasn't seeded it) => the legacy flow:
  // no authority step, catalogue fetched at the base tenant, no extendedAttributes.
  const { data: relatedToOptions, isLoading: isDispatcherLoading } = Digit.Hooks.useCustomMDMS(
    stateTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintRelatedToMap" }],
    {
      cacheTime: Infinity,
      select: (raw: any) =>
        ((raw?.["RAINMAKER-PGR"]?.ComplaintRelatedToMap || []) as RelatedToOption[])
          .filter((o) => o?.active !== false && !!o?.relatedTo && !!o?.tenantId && !!o?.templateType)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    },
    { schemaCode: "PGR_COMPLAINT_RELATED_TO_MAP", tenantId: stateTenant }
  );
  const hasDispatcher = Array.isArray(relatedToOptions) && relatedToOptions.length > 0;

  // Catalogue tenant: the authority-resolved sub-tenant once picked, else the
  // base tenant (legacy). Changing it re-fetches the hierarchy at that tenant.
  const resolvedTenant = formData.resolvedTenantId || baseTenant;
  const templateType = formData.templateType;

  // The single RAINMAKER-PGR.ComplaintHierarchy adjacency list (interior nodes
  // + leaf complaint types) is the only complaint-type master now. We derive:
  //   - serviceDefs: leaf rows mapped to the legacy shape (serviceCode=code,
  //     menuPath=parentCode) so the flat fallback picker keeps working verbatim;
  //   - hierData.nodes: the full row set the N-level cascade picker walks.
  // Absent definition => the flat menuPath (=parentCode) picker is used.
  const { data: hierAll, isLoading: isMDMSLoading, isFetching: isMDMSFetching } = Digit.Hooks.useCustomMDMS(
    resolvedTenant,
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
    { schemaCode: "PGR_COMPLAINT_HIERARCHY", tenantId: resolvedTenant }
  );

  const serviceDefs = hierAll?.serviceDefs;
  const hierData = hierAll ? { def: hierAll.def, nodes: hierAll.nodes } : undefined;

  // Which tenant the currently-held catalogue was fetched for. The shared MDMS
  // hook forces keepPreviousData, so on an authority switch isLoading stays
  // false and `serviceDefs` briefly holds the PREVIOUS tenant's rows. Comparing
  // the resolved tenant to the last-settled one (updated only when a fetch
  // completes) is frame-accurate — the "complaint" step shows the inline
  // spinner the instant the tenant changes, never the stale options — and does
  // NOT trigger on same-tenant background refetches (which would reset the picker).
  // Track (in STATE, not a ref) the tenant the catalogue last SETTLED for. State
  // is required so that when the new tenant's fetch completes the component
  // re-renders and the spinner gives way to the picker — a ref update wouldn't
  // trigger a render, so the spinner would stick (and now that staleTime is a
  // day for caching, there's no background refetch to mask it). setState to the
  // same value is a no-op render, so no loop / no flicker on background refetch.
  const [catalogueLoadedFor, setCatalogueLoadedFor] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!isMDMSFetching) setCatalogueLoadedFor(resolvedTenant);
  }, [isMDMSFetching, resolvedTenant]);
  const catalogueStale = catalogueLoadedFor !== resolvedTenant;

  // Dynamic "additional details" fields (RAINMAKER-PGR.ComplaintTemplateType @
  // state tenant), keyed by the resolved templateType. FAIL-CLOSED: fields
  // flagged pii/encrypted/maskable are excluded (no FE encryption/masking yet).
  const { data: templatesAll } = Digit.Hooks.useCustomMDMS(
    stateTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintTemplateType" }],
    {
      cacheTime: Infinity,
      select: (raw: any) =>
        (raw?.["RAINMAKER-PGR"]?.ComplaintTemplateType || []) as Array<{
          templateType: string;
          active?: boolean;
          fields?: TemplateField[];
        }>,
    },
    { schemaCode: "PGR_COMPLAINT_TEMPLATE_TYPE", tenantId: stateTenant }
  );
  // Resolve to the picked templateType's visible fields here (not in select) so
  // it recomputes when templateType changes without re-fetching.
  const { templateFields, suppressedCount } = React.useMemo(() => {
    const entry = (templatesAll || []).find(
      (x: any) => x?.active !== false && x?.templateType === templateType
    );
    const allFields: TemplateField[] = (entry?.fields || [])
      .slice()
      .sort((a: TemplateField, b: TemplateField) => (a.order ?? 0) - (b.order ?? 0));
    const visible = allFields.filter((f) => !isProtectedField(f));
    return { templateFields: visible, suppressedCount: allFields.length - visible.length };
  }, [templatesAll, templateType]);

  const { mutate: createMutation } = Digit.Hooks.pgr.useCreateComplaint(resolvedTenant);

  const patch = React.useCallback((partial: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
    if (error) setError(null);
  }, [error]);

  // Consolidated 3-step wizard. The related-to dispatcher is no longer its own
  // step — it folds into step "complaint" (rendered above the type picker), so
  // the step list is constant regardless of whether the dispatcher is seeded.
  const steps = STEPS;
  const curId = steps[stepIndex]?.id;
  const isLast = stepIndex === steps.length - 1;

  // Mirror map-derived pincode onto postalCode (matches FormExplorer's effect).
  React.useEffect(() => {
    const pin = formData?.GeoLocationsPoint?.pincode;
    const desired = pin != null && String(pin).length > 0 ? String(pin) : undefined;
    if (desired !== undefined && formData.postalCode !== desired) {
      setFormData((prev) => ({ ...prev, postalCode: desired }));
    }
  }, [formData?.GeoLocationsPoint?.pincode, formData.postalCode]);

  const stepIsValid = React.useMemo(() => {
    switch (curId) {
      case "complaint": {
        // Dispatcher (if seeded) must be answered, then a leaf complaint type.
        if (hasDispatcher && !formData.relatedTo) return false;
        if (!isFieldValid(formData, "SelectComplaintType")) return false;
        // Sub-type is conditionally mandatory: if the chosen type has sub-services
        // in the same menuPath, one must be picked (mirrors legacy FormExplorer).
        const mainPath = formData.SelectComplaintType?.menuPath;
        const subTypeOptions = (Array.isArray(serviceDefs) ? serviceDefs : []).filter(
          (s: ServiceDef) => s.menuPath === mainPath
        );
        if (subTypeOptions.length > 1 && !formData.SelectSubComplaintType) return false;
        return true;
      }
      case "where":
        // Map pin + a leaf ward (auto-cascaded from the pin; manual fallback).
        return (
          isFieldValid(formData, "GeoLocationsPoint") &&
          isFieldValid(formData, "SelectedBoundary")
        );
      case "details": {
        if (!isFieldValid(formData, "description")) return false;
        // Mandatory dynamic fields (dispatcher flow).
        for (const f of templateFields) {
          if (f.mandatory && !String((formData.dynamicFields || {})[f.fieldKey] ?? "").trim()) return false;
        }
        // Both consents are required once an authority/template is in play.
        if (formData.templateType && REQUIRED_CONSENTS.some((c) => !(formData.consents || []).includes(c.code))) {
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  }, [curId, formData, serviceDefs, templateFields, hasDispatcher]);

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
      const payload = mapFormDataToRequest(formData, resolvedTenant, user?.info ?? user);
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

  // NOTE: catalogue/dispatcher loading is handled INLINE inside the "complaint"
  // step (StepComplaint) now — we no longer blank the whole screen, so picking
  // an authority doesn't flash a full-page spinner mid-step.

  const stepProps: StepBodyProps = {
    data: formData,
    patch,
    serviceDefs: Array.isArray(serviceDefs) ? serviceDefs : [],
    hierarchyDef: hierData?.def ?? null,
    nodes: hierData?.nodes ?? [],
    t,
    relatedToOptions: Array.isArray(relatedToOptions) ? relatedToOptions : [],
    templateFields,
    suppressedCount,
    resolvedTenant,
    catalogueLoading: isMDMSLoading || catalogueStale,
    dispatcherLoading: isDispatcherLoading,
  };

  return (
    <ScreenContainer>
      <div style={{ padding: "0.75rem 1.25rem 0 1.25rem", flexShrink: 0 }}>
        <ScreenHeader
          title={tr(t, "CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
        />
        <WizardProgress steps={steps} current={stepIndex} t={t} />
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
        {curId === "complaint" && <StepComplaint {...stepProps} />}
        {curId === "where" && <StepWhere {...stepProps} />}
        {curId === "details" && <StepDetails {...stepProps} />}
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
