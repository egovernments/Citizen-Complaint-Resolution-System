/* eslint-disable @typescript-eslint/no-explicit-any */
// Citizen file-complaint flow — v2 (Tailwind + shadcn-style chrome).
//
// This is a strangler-fig replacement for the FormExplorer.js + steps-config/*
// + FormComposerV2 stack. The same 6-step shape is preserved so:
//   - the data shape submitted to /pgr/v1/_create is byte-identical
//   - the boundary, geolocation, and image-upload behaviour stays in the
//     existing components (PGRBoundaryComponent, GeoLocations) + the V2
//     PgrFileUpload, just rendered inside v2 chrome
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
  ward?: { code?: string; name?: string } | null;
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
  caseRelatedTo?: string; // category code (doc discriminator; FK → ComplaintRelatedToMap.code)
  caseRelatedToName?: string; // display name of the picked category
  resolvedTenantId?: string; // sub-tenant the complaint files under (ComplaintRelatedToMap.tenantCode)
  dynamicFields?: Record<string, unknown>;
  consents?: string[];
  isConfidential?: boolean; // doc "Keep details confidential" (backend-enforced later)
  // Reporter identity (step 1, optional, prefilled from the citizen profile).
  // Travels in extendedAttributes — deliberately NOT citizen.name: posting an
  // edited name back to the user service triggers its masked-update rejection.
  complainantName?: string;
  complainantAddress?: string;
  email?: string;
}

// RAINMAKER-PGR.ComplaintRelatedToMap — the citizen-facing category lookup. Maps
// a category `code` → display name + the sub-tenant the complaint is filed under.
// State-level master.
interface RelatedToOption {
  code: string; // category code (e.g. IGE | IGSAE)
  name: string; // citizen-facing display name
  shortName?: string;
  tenantCode: string; // sub-tenant the complaint is filed under
  tenantId?: string; // parent state tenant
  displayOrder?: number;
  active?: boolean;
}

// A renderable dynamic field, derived from the per-category JSON Schema
// (RAINMAKER-PGR.ComplaintExtendedAttributeSchema.schema.properties).
interface TemplateField {
  fieldKey: string;
  labelKey?: string; // x-label-key → localization key for the label
  label: string; // human fallback (prettified fieldKey)
  dataType?: string; // string | textarea | date | number | boolean
  mandatory?: boolean; // from schema.required
  maxLength?: number;
  order?: number; // from x-order
  encrypted?: boolean; // from top-level x-security (informational; backend encrypts)
}

// camelCase fieldKey → "Title Case" fallback label.
function prettifyKey(k: string): string {
  const s = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Build renderable fields from a draft-07 JSON Schema object (properties +
// required + x-security + the x-order / x-widget / x-label-key UI hints).
// Control/standard keys are skipped (rendered elsewhere or sent automatically).
function fieldsFromSchema(schema: any): TemplateField[] {
  if (!schema || typeof schema !== "object" || !schema.properties) return [];
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const security: string[] = Array.isArray(schema["x-security"]) ? schema["x-security"] : [];
  const CONTROL = new Set([
    "caseRelatedTo",
    "isConfidential",
    "schemaVersion",
    "hierarchyLevel1",
    "hierarchyLevel2",
    "complainantName",
    "complainantAddress",
    "email",
  ]);
  return Object.keys(schema.properties)
    .filter((k) => !CONTROL.has(k))
    .map((k) => {
      const p = schema.properties[k] || {};
      const widget = p["x-widget"];
      const dataType =
        widget === "textarea"
          ? "textarea"
          : p.format === "date"
          ? "date"
          : p.type === "number" || p.type === "integer"
          ? "number"
          : p.type === "boolean"
          ? "boolean"
          : "string";
      return {
        fieldKey: k,
        labelKey: p["x-label-key"],
        label: prettifyKey(k),
        dataType,
        mandatory: required.includes(k),
        maxLength: typeof p.maxLength === "number" ? p.maxLength : undefined,
        order: typeof p["x-order"] === "number" ? p["x-order"] : 999,
        encrypted: security.includes(k),
      } as TemplateField;
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  collapsible?: boolean;
  children: React.ReactNode;
}

// Consolidated 3-step wizard (was 6 screens). Each step groups what used to be
// separate screens so the citizen reaches Submit in far fewer taps:
//   complaint — "what is it about?" (related-to dispatcher) + the complaint type
//   where     — map pin + ward (auto-cascaded from the pin) + landmark/postal
//   details   — description + dynamic category fields + photos + consents → submit
const STEPS = [
  { id: "complaint", title: "Complaint", sub: "Tell us about the issue" },
  { id: "where", title: "Location", sub: "Where did it happen?" },
  { id: "details", title: "Details", sub: "Additional information" },
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

function mapFormDataToRequest(formData: FormData, tenantId: string, user: any, documentType = "EVIDENCE") {
  const timestamp = Date.now();
  const userInfo = user;
  // FLAT extendedAttributes (doc §2/§5) ride at the TOP LEVEL of service —
  // jsonPath $.service.extendedAttributes (a dedicated JSONB column), NOT nested
  // under additionalDetail. Built only when a category was resolved (legacy flow
  // unchanged). complainantAddress/email travel here too but the backend strips
  // them to the User Service (eg_user_address / eg_user.emailaddress) — they are
  // not stored as category data. NOTE: x-security fields are submitted in clear
  // text until the backend encryption phase lands.
  const additionalDetail: Record<string, unknown> = {};
  let extendedAttributes: Record<string, unknown> | undefined;
  if (formData?.caseRelatedTo) {
    const sct: any = formData.SelectComplaintType;
    const sst: any = formData.SelectSubComplaintType;
    const lvl1 = sct?.code ?? sct?.name;
    const lvl2 = sst?.code ?? sst?.name;
    extendedAttributes = {
      caseRelatedTo: formData.caseRelatedTo,
      isConfidential: !!formData.isConfidential,
      schemaVersion: "1.0",
      ...(lvl1 ? { hierarchyLevel1: lvl1 } : {}),
      ...(lvl2 ? { hierarchyLevel2: lvl2 } : {}),
      ...(formData.complainantName ? { complainantName: formData.complainantName } : {}),
      ...(formData.complainantAddress ? { complainantAddress: formData.complainantAddress } : {}),
      ...(formData.email ? { email: formData.email } : {}),
      consents: formData.consents || [],
      ...(formData.dynamicFields || {}),
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
      // Top-level service.extendedAttributes (doc jsonPath $.service.extendedAttributes).
      // Attached only when a category resolved; legacy/no-category flow is unchanged.
      ...(extendedAttributes ? { extendedAttributes } : {}),
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
            documentType,
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

function StepShell({ title, description, collapsible, children }: StepShellProps) {
  const [open, setOpen] = React.useState(true);
  const showBody = !collapsible || open;
  return (
    <Card className="p-6">
      <div className="flex items-start" style={{ justifyContent: "space-between", gap: "1rem", marginBottom: showBody ? "1.25rem" : 0 }}>
        <div style={{ minWidth: 0 }}>
          {/* Theme-driven heading color (PRIMARY var) — same chain the legacy headings use. */}
          <h2 className="text-lg font-semibold" style={{ margin: 0, color: PRIMARY }}>
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-sm"
            style={{
              color: PRIMARY, background: "none", border: "none", cursor: "pointer",
              whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "0.25rem", flexShrink: 0,
            }}
          >
            {open ? "Collapse" : "Expand"}<span aria-hidden>{open ? "▲" : "▼"}</span>
          </button>
        ) : null}
      </div>
      {showBody ? children : null}
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
          value={data.caseRelatedTo}
          onValueChange={(value: string) => {
            const o = options.find((x) => x.code === value);
            if (!o) return;
            patch({
              caseRelatedTo: o.code,
              caseRelatedToName: o.name,
              resolvedTenantId: o.tenantCode,
              // Category drives the catalogue + fields — reset downstream.
              SelectComplaintType: null,
              SelectSubComplaintType: null,
              dynamicFields: {},
            });
          }}
          placeholder={tr(t, "CS_COMPLAINT_PICK_ONE", "Select…")}
          options={options.map((o) => ({ value: o.code, label: o.name }))}
        />
        {data.caseRelatedToName ? (
          <FieldHelp ok>{data.caseRelatedToName}</FieldHelp>
        ) : (
          <FieldHelp>{tr(t, "CS_RELATED_TO_HELP", "Choose the organization or entity responsible for the issue.")}</FieldHelp>
        )}
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
    <StepShell title={t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")} collapsible>
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
        <TipBox body={tr(t, "CS_COMPLAINT_TYPE_TIP", "Choose the most relevant option that best describes your issue.")} />
      </div>
    </StepShell>
  );
}

// ── Section header (title + subtitle) for the unified "Where" card ──
// Footer nav arrows as SVGs: the ←/→ TEXT glyphs sit off the optical center of
// the label no matter how they are flexed (font draws them low in the em-box).
const ArrowLeftIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block" }}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);
const ArrowRightIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block" }}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

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
            // Postal code is NOT mirrored from the pin: geocoder pincodes come in
            // foreign formats ("0101-03") that fail the tenant's pattern and block
            // NEXT with a validation error the citizen never typed. The field is
            // optional — leave it to manual entry only.
            patch({ GeoLocationsPoint: value });
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

function Step3Description({ data, patch, templateFields, t }: StepBodyProps) {
  const fields = templateFields || [];
  const dyn = data.dynamicFields || {};
  const consents = data.consents || [];
  const extended = !!data.caseRelatedTo; // dispatcher flow active
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
            <Field key={f.fieldKey} label={f.labelKey ? tr(t, f.labelKey, f.label) : f.label} required={!!f.mandatory} htmlFor={`xf-${f.fieldKey}`}>
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
                  className={f.dataType === "date" ? "pgr-date-input" : undefined}
                  type={f.dataType === "date" ? "date" : f.dataType === "number" ? "number" : "text"}
                  maxLength={f.dataType === "date" || f.dataType === "number" ? undefined : f.maxLength}
                  value={val}
                  onChange={(e) => setDyn(f.fieldKey, e.target.value)}
                />
              )}
            </Field>
          );
        })}

        {/* Complainant name + address + email moved to step 1 (ReporterDetailsCard, prefilled). */}

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
                <span>
                  {c.label}
                  {/* Same required marker the design-system Label renders. */}
                  <span className="ml-0.5 text-destructive" style={{ color: "var(--color-error, #d4351c)" }} aria-hidden>
                    *
                  </span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-sm pt-2 border-t border-border">
              <input
                type="checkbox"
                style={CHECKBOX_STYLE}
                checked={!!data.isConfidential}
                onChange={(e) => patch({ isConfidential: e.target.checked })}
              />
              <span>
                {tr(t, "PGR_EXT_IS_CONFIDENTIAL_LABEL", "Keep details confidential.")}{" "}
                <span className="text-muted-foreground">
                  {tr(t, "PGR_EXT_IS_CONFIDENTIAL_HINT", "Visibility is enforced once secure handling is enabled; for now this flags the complaint for staff awareness.")}
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </StepShell>
  );
}

// ── Step-4 uploader (build-v2). Self-contained: replaces the legacy
// SelectImages → FormStep → ImageUploadHandler chain that couldn't render the
// mockup's filled state. Reuses the SAME upload service the legacy handler used
//   Digit.UploadServices.Filestorage("property-upload", file, tenantId)
// and emits the SAME output the submit contract expects — a string[] of
// fileStoreIds via onSelect → patch({ComplaintImagesPoint}) — which
// mapFormDataToRequest turns into workflow.verificationDocuments. No new deps.
const PGR_MAX_FILES = 5; // max files the citizen can attach
const PGR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — same per-file size as the legacy uploader

type PgrUploadItem = { id: string; url: string; name: string; size: number };

function pgrFmtSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const PgrCheckIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const PgrCloudIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 16l-4-4-4 4" />
    <path d="M12 12v9" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);
const PgrXIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function PgrFileUpload({
  t,
  tenantId,
  value,
  onSelect,
  fieldKey,
}: {
  t: (k: string) => string;
  tenantId: string;
  value: string[];
  onSelect: (key: string, ids: string[]) => void;
  fieldKey: string;
}) {
  const [items, setItems] = React.useState<PgrUploadItem[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState<string>("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Rebuild previews for ids that arrive from outside (e.g. the citizen steps
  // back into Step 4). Best-effort — the ids are valid for submit regardless.
  React.useEffect(() => {
    const have = new Set(items.map((i) => i.id));
    const missing = (value || []).filter((id) => !have.has(id));
    if (missing.length === 0) {
      if (items.some((i) => !(value || []).includes(i.id))) {
        setItems((prev) => prev.filter((i) => (value || []).includes(i.id)));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await Digit.UploadServices.Filefetch(missing, tenantId);
        if (cancelled) return;
        const d = res?.data || {};
        const byId: Record<string, string> = {};
        (Array.isArray(d.fileStoreIds) ? d.fileStoreIds : []).forEach((o: any) => {
          if (o && o.id) byId[o.id] = o.url;
        });
        const rebuilt: PgrUploadItem[] = missing.map((id) => {
          const raw = byId[id] != null ? byId[id] : (typeof d[id] === "string" ? d[id] : "");
          const url = typeof raw === "string" ? raw.split(",").pop() || "" : "";
          return { id, url, name: tr(t, "CS_UPLOADED_FILE", "Attachment"), size: 0 };
        });
        setItems((prev) => [...prev, ...rebuilt]);
      } catch {
        /* preview rebuild is best-effort; ids still submit */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tenantId]);

  const emit = (next: PgrUploadItem[]) => {
    setItems(next);
    onSelect(fieldKey, next.map((i) => i.id));
  };

  const uploadFiles = React.useCallback(
    async (files: File[]) => {
      setError("");
      const room = PGR_MAX_FILES - items.length;
      if (room <= 0) {
        setError(tr(t, "CS_UPLOAD_MAX_FILES", "You can upload up to 5 files."));
        return;
      }
      const accepted: File[] = [];
      for (const f of files.slice(0, room)) {
        if (f.size > PGR_MAX_BYTES) {
          setError(tr(t, "CS_FILE_TOO_LARGE", "File is too large (max 2 MB)."));
          continue;
        }
        accepted.push(f);
      }
      if (accepted.length === 0) return;
      setBusy(true);
      const uploaded: PgrUploadItem[] = [];
      for (const file of accepted) {
        try {
          // SAME service the legacy handler used (module "property-upload").
          const response = await Digit.UploadServices.Filestorage("property-upload", file, tenantId);
          const id = response?.data?.files?.[0]?.fileStoreId;
          if (id) {
            uploaded.push({
              id,
              url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
              name: file.name,
              size: file.size,
            });
          }
        } catch (err: any) {
          const apiMessage =
            err?.response?.data?.Errors?.[0]?.message ||
            err?.response?.data?.message ||
            err?.message;
          setError(apiMessage || tr(t, "CS_FILE_UPLOAD_FAILED", "File upload failed."));
        }
      }
      setBusy(false);
      if (uploaded.length) emit([...items, ...uploaded]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, tenantId, t]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) uploadFiles(files);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking same file
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  };
  const removeAt = (id: string) => {
    const gone = items.find((i) => i.id === id);
    if (gone?.url?.startsWith("blob:")) URL.revokeObjectURL(gone.url);
    emit(items.filter((i) => i.id !== id));
  };
  const openPicker = () => inputRef.current?.click();
  const atMax = items.length >= PGR_MAX_FILES;

  // The cloud + drag-drop + Choose-files affordance — shared by the empty
  // state and the inline "add more" cell of the filled state.
  const renderCue = (variant: string) => (
    <div
      className={"pgr-upload-zone " + variant + (dragOver ? " is-dragover" : "")}
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <span className="pgr-upload-cloud">{PgrCloudIcon}</span>
      <div className="pgr-upload-dnd">{tr(t, "CS_UPLOAD_DND", "Drag and drop files here or")}</div>
      <span className="pgr-upload-choose">
        {busy ? tr(t, "CS_UPLOADING", "Uploading…") : tr(t, "CS_UPLOAD_CHOOSE", "Choose files")}
      </span>
      <p className="pgr-upload-hint">
        {tr(t, "CS_UPLOAD_HINT", "JPG, PNG up to 2 MB each. You can upload up to 5 files.")}
      </p>
    </div>
  );

  return (
    <div className="pgr-upload">
      {error ? (
        <div className="pgr-upload-error" role="alert">
          {error}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onInputChange}
        // Do NOT use display:none. Some Android WebViews refuse to fire the file
        // chooser (WebChromeClient.onShowFileChooser) for a programmatic .click()
        // on a display:none input — the tap silently does nothing. Keep the input
        // rendered but visually hidden so the chooser opens inside the WebView.
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          overflow: "hidden",
          border: 0,
          padding: 0,
          margin: -1,
          clip: "rect(0 0 0 0)",
          pointerEvents: "none",
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      {items.length === 0 ? (
        renderCue("pgr-upload-zone--empty")
      ) : (
        <div className="pgr-upload-row">
          {items.map((it) => (
            <div className="pgr-card" key={it.id}>
              <div className="pgr-card-img">
                <span className="pgr-badge">{PgrCheckIcon}</span>
                <button
                  type="button"
                  className="pgr-del"
                  aria-label={tr(t, "CS_REMOVE", "Remove")}
                  onClick={() => removeAt(it.id)}
                >
                  {PgrXIcon}
                </button>
                {it.url ? (
                  <img src={it.url} alt={it.name} />
                ) : (
                  <div className="pgr-card-doc">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="pgr-card-name" title={it.name}>
                {it.name}
              </div>
              <div className="pgr-card-meta">
                {it.size ? <span>{pgrFmtSize(it.size)}</span> : null}
                <span className="pgr-card-ok">{PgrCheckIcon}</span>
              </div>
            </div>
          ))}
          {!atMax ? renderCue("pgr-upload-zone--cell") : null}
        </div>
      )}
    </div>
  );
}

function Step4Images({ data, patch, t }: StepBodyProps) {
  // Same tenant the complaint submits under (resolved from the authority pick),
  // falling back to the citizen's home city / current ULB — so uploads land on
  // the tenant whose filestore the submit will reference.
  const tenantId =
    (data as any)?.resolvedTenantId ||
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  return (
    <StepShell title={tr(t, "CS_ADDCOMPLAINT_UPLOAD_PHOTO", "Upload photos / attachments") + " " + tr(t, "CS_OPTIONAL_SUFFIX", "(Optional)")}>
      <PgrFileUpload
        t={t}
        tenantId={tenantId}
        fieldKey="ComplaintImagesPoint"
        value={Array.isArray(data.ComplaintImagesPoint) ? data.ComplaintImagesPoint : []}
        onSelect={(_key: string, value: string[]) => {
          patch({ ComplaintImagesPoint: value });
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

// Subtle theme-tinted surfaces for banners/tips (the accent itself stays PRIMARY).
const HINT_BG = "var(--color-primary-1-bg, #edf6ef)";
const HINT_BORDER = "var(--color-primary-2-bg, #cfe6d6)";

// Responsive tweaks that DON'T rely on Tailwind md: utilities (the vendored CSS may
// lack them). Injected once by the orchestrator — keeps the stepper mobile-safe.
const WIZARD_CSS = `
.pgr-step-sub { display:block; }
@media (max-width: 640px) {
  .pgr-step-sub { display:none; }
  .pgr-step-title { font-size:0.8rem; }
}
/* ---- Step 4 uploader (build-v2, PgrFileUpload). All scoped to .pgr-upload so
   no other upload flow is affected. ---- */
.pgr-upload { width: 100%; }
.pgr-upload-error {
  margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.5rem;
  background: #fdecea; border: 1px solid #f5c2bc; color: #b3261e;
  font-size: 0.8rem; text-align: center;
}
/* cloud + drag-drop + Choose-files affordance (shared by both states) */
.pgr-upload-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.4rem; padding: 1.5rem 1rem; text-align: center; cursor: pointer;
  border: 1px dashed var(--color-border, #cbd5e1); border-radius: 0.75rem;
  background: var(--color-surface-secondary, #f8fafc);
  transition: border-color .15s ease, background .15s ease;
}
.pgr-upload-zone--empty { padding: 2rem 1rem; }
.pgr-upload-zone--cell { border-radius: 0.5rem; padding: 1rem; }
.pgr-upload-zone:hover, .pgr-upload-zone:focus-visible, .pgr-upload-zone.is-dragover {
  outline: none;
  border-color: var(--color-primary-1, var(--color-primary-main, #c84c0e));
  background: var(--color-primary-1-bg, #eef6ef);
}
.pgr-upload-cloud { color: var(--color-text-secondary, #94a3b8); display: inline-flex; }
.pgr-upload-dnd { font-size: 0.85rem; color: var(--color-text-secondary, #64748b); }
.pgr-upload-choose {
  display: inline-block; border: 1px solid var(--color-border, #cbd5e1); border-radius: 0.375rem;
  padding: 0.4rem 0.9rem; background: #fff; font-weight: 600; font-size: 0.85rem;
  color: var(--color-primary-1, var(--color-primary-main, #c84c0e));
}
.pgr-upload-hint { margin: 0.25rem 0 0; font-size: 0.72rem; color: var(--color-text-secondary, #94a3b8); }
/* filled state: thumbnail cards + inline cue */
/* Uniform grid — every cell (each card AND the Choose-files box) is one equal
   column, so they're all the same width instead of small-cards + a big box. */
.pgr-upload-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.75rem; align-items: stretch; }
.pgr-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--color-border, #e2e8f0); border-radius: 0.5rem;
  padding: 0.5rem; background: #fff;
}
/* The image flex-fills the card; the grid stretches every cell to the tallest
   in the row (the Choose-files box), so cards & box share one height with no
   empty gap AND the box never overflows. No aspect-ratio (flaky in old webviews). */
.pgr-card-img {
  position: relative; flex: 1 1 auto; min-height: 4.5rem; border-radius: 0.375rem; overflow: hidden;
  background: var(--color-surface-secondary, #f1f5f9);
}
.pgr-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pgr-card-doc { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary, #64748b); }
.pgr-badge {
  position: absolute; top: 6px; left: 6px; width: 20px; height: 20px; border-radius: 9999px;
  background: var(--color-primary-1, var(--color-primary-main, #c84c0e)); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.pgr-del {
  position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border: none; border-radius: 9999px;
  background: #fff; color: #475569; font-size: 15px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.25);
}
.pgr-del:hover { background: #b3261e; color: #fff; }
.pgr-card-name {
  font-size: 0.78rem; font-weight: 600; margin-top: 0.35rem; color: var(--color-text, #1f2937);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pgr-card-meta { display: flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--color-text-secondary, #64748b); }
.pgr-card-ok { color: var(--color-primary-1, var(--color-primary-main, #c84c0e)); display: inline-flex; }
@media (max-width: 480px) {
  .pgr-upload-row { grid-template-columns: repeat(2, 1fr); }
}
/* Date input: a global (health-css) rule makes the calendar indicator
   position:absolute, so without position:relative on the input it escapes to
   the nearest positioned ancestor (it was showing up near the stepper). Anchor
   it back inside its own field and centre it vertically. */
.pgr-date-input { position: relative; }
.pgr-date-input::-webkit-calendar-picker-indicator { right: 10px !important; top: 50% !important; transform: translateY(-50%) !important; }
`;

// Contextual hint banner shown at the top of each step (themed, green-tinted).
function HintBanner({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", background: HINT_BG, border: "1px solid " + HINT_BORDER, borderRadius: "0.5rem", padding: "0.85rem 1rem" }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.75rem", height: "1.75rem", borderRadius: "9999px", background: "var(--color-primary-2-bg, #dcecdf)", color: PRIMARY, flexShrink: 0 }}>{TipBulbIcon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="text-sm font-semibold" style={{ color: PRIMARY }}>{title}</div>
        {subtitle ? <div className="text-sm text-muted-foreground" style={{ marginTop: "0.1rem" }}>{subtitle}</div> : null}
      </div>
    </div>
  );
}

// Reusable green tip callout.
function TipBox({ title, body }: { title?: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", background: HINT_BG, border: "1px solid " + HINT_BORDER, borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
      <span style={{ color: PRIMARY, flexShrink: 0, marginTop: "1px", display: "inline-flex" }}>{TipBulbIcon}</span>
      <div className="text-sm">
        {title ? <div className="font-medium" style={{ color: PRIMARY }}>{title}</div> : null}
        <div className="text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

// Small helper / confirmation line under a field (ⓘ hint, or ✓ when satisfied).
function FieldHelp({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div className="mt-1 text-xs" style={{ display: "flex", gap: "0.35rem", alignItems: "flex-start", color: ok ? PRIMARY : "var(--color-text-secondary, #64748b)" }}>
      <span aria-hidden style={{ flexShrink: 0 }}>{ok ? "✓" : "ⓘ"}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

// Muted dashed placeholder shown before a category is chosen.
const HowToTagIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const HowToPinIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const HowToDocIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

// Shown before a category is picked: a short, friendly "how it works" guide
// (mirrors the 3 wizard steps) — more useful than an empty placeholder.
function EmptyStateCard({ t }: { t: (k: string) => string }) {
  const circle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "1.75rem", height: "1.75rem", borderRadius: "9999px",
    background: "var(--color-primary-2-bg, #dcecdf)", color: PRIMARY, flexShrink: 0,
  };
  const steps = [
    { icon: HowToTagIcon, title: tr(t, "CS_HOWTO_1_TITLE", "Choose a category"), body: tr(t, "CS_HOWTO_1_BODY", "Tell us what your complaint is about — it's routed to the right office automatically.") },
    { icon: HowToPinIcon, title: tr(t, "CS_HOWTO_2_TITLE", "Mark the location"), body: tr(t, "CS_HOWTO_2_BODY", "Drop a pin on the map where the issue happened.") },
    { icon: HowToDocIcon, title: tr(t, "CS_HOWTO_3_TITLE", "Add details & submit"), body: tr(t, "CS_HOWTO_3_BODY", "Describe the issue and attach any photos as evidence.") },
  ];
  // Compact single strip: the three steps inline (titles only, bodies dropped)
  // — the walkthrough was eating ~half the first screen (CCRS feedback).
  return (
    <div style={{ border: "1px dashed var(--color-border, #cbd5e1)", borderRadius: "0.75rem", padding: "0.65rem 1rem", background: "var(--color-surface-secondary, #f8fafc)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem 1.25rem" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
        <span style={circle}>{TipBulbIcon}</span>
        <span className="text-xs font-semibold" style={{ color: PRIMARY }}>{tr(t, "CS_HOWTO_SUB", "Three quick steps — pick a category above to begin.")}</span>
      </span>
      {steps.map((s, i) => (
        <span key={i} className="text-xs text-muted-foreground" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
          <span style={{ ...circle, width: "1.15rem", height: "1.15rem", fontSize: "0.65rem", fontWeight: 600 }}>{i + 1}</span>
          {s.title}
        </span>
      ))}
    </div>
  );
}

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
// Step 1 — "Who is reporting": optional reporter identity card, prefilled from
// the logged-in citizen's profile (name + address editable per complaint). The
// values travel in extendedAttributes (complainantName/complainantAddress), so
// editing them never round-trips through the user service.
function ReporterDetailsCard({ data, patch, t }: StepBodyProps) {
  React.useEffect(() => {
    const info = Digit.UserService.getUser()?.info;
    const prefill: Partial<FormData> = {};
    if (data.complainantName === undefined && info?.name) prefill.complainantName = info.name;
    if (data.complainantAddress === undefined && (info?.permanentAddress || info?.correspondenceAddress)) {
      prefill.complainantAddress = info.permanentAddress || info.correspondenceAddress;
    }
    if (data.email === undefined && info?.emailId) prefill.email = info.emailId;
    if (Object.keys(prefill).length) patch(prefill);
  }, []);
  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold">{tr(t, "CS_REPORTER_DETAILS_TITLE", "Your details")}</h3>
        <p className="text-sm text-muted-foreground">
          {tr(t, "CS_REPORTER_DETAILS_SUB", "Shown to the handling officers. You can edit them for this complaint.")}
        </p>
      </div>
      <Field label={tr(t, "CS_REPORTER_FULL_NAME_LABEL", "Full Name")} htmlFor="reporter-name">
        <Input
          id="reporter-name"
          maxLength={128}
          value={data.complainantName ?? ""}
          onChange={(e) => patch({ complainantName: e.target.value })}
        />
        <FieldHelp>{tr(t, "CS_COMMON_OPTIONAL", "Optional")}</FieldHelp>
      </Field>
      <Field label={tr(t, "CS_REPORTER_ADDRESS_LABEL", "Address")} htmlFor="reporter-address">
        <Input
          id="reporter-address"
          maxLength={300}
          value={data.complainantAddress ?? ""}
          onChange={(e) => patch({ complainantAddress: e.target.value })}
        />
        <FieldHelp>{tr(t, "CS_COMMON_OPTIONAL", "Optional")}</FieldHelp>
      </Field>
      <Field label={tr(t, "PGR_EXT_EMAIL_LABEL", "Email Address")} htmlFor="reporter-email">
        <Input
          id="reporter-email"
          type="email"
          value={data.email ?? ""}
          onChange={(e) => patch({ email: e.target.value })}
        />
        <FieldHelp>{tr(t, "CS_COMMON_OPTIONAL", "Optional")}</FieldHelp>
      </Field>
    </Card>
  );
}

function StepComplaint(props: StepBodyProps) {
  const { data, relatedToOptions, catalogueLoading, dispatcherLoading, t } = props;
  const hasDispatcher = (relatedToOptions?.length ?? 0) > 0;
  if (dispatcherLoading) return <InlineSpinner />;
  const showType = !hasDispatcher || !!data.caseRelatedTo;
  return (
    <div className="space-y-5">
      <HintBanner
        title={showType
          ? tr(t, "CS_HINT_TYPE_TITLE", "Great! Now select the type of complaint.")
          : tr(t, "CS_HINT_RELATED_TITLE", "Start by selecting what your complaint is about.")}
        subtitle={showType
          ? tr(t, "CS_HINT_TYPE_SUB", "This helps us route your complaint to the right team.")
          : tr(t, "CS_HINT_RELATED_SUB", "Based on your selection, relevant options will appear automatically.")}
      />
      {hasDispatcher ? <RelatedToStepBody {...props} /> : null}
      <ReporterDetailsCard {...props} />
      {showType ? (
        catalogueLoading ? <InlineSpinner /> : <Step0Type {...props} />
      ) : (
        <EmptyStateCard t={t} />
      )}
    </div>
  );
}

// Step 2 — "Where": ONE unified card with the map (left, larger) and Location
// details (right). flex-wrap stacks them on mobile (no Tailwind md: needed).
// align-items:flex-start keeps the form pinned top-right beside the capped map.
function StepWhere(props: StepBodyProps) {
  return (
    <div className="space-y-5">
      <HintBanner
        title={tr(props.t, "CS_HINT_LOC_TITLE", "Pin the exact location")}
        subtitle={tr(props.t, "CS_HINT_LOC_SUB", "Drop a pin on the map or search for the location where the issue occurred.")}
      />
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
    </div>
  );
}

// Step 3 — "Details": description + dynamic category fields + consents + photos.
function StepDetails(props: StepBodyProps) {
  return (
    <div className="space-y-5">
      <HintBanner
        title={tr(props.t, "CS_HINT_DETAILS_TITLE", "Tell us more about the issue")}
        subtitle={tr(props.t, "CS_HINT_DETAILS_SUB", "Add as much detail as possible to help us take the right action.")}
      />
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
  steps: ReadonlyArray<{ id: string; title: string; sub?: string }>;
  current: number;
  t: (k: string) => string;
}) {
  return (
    <div className="flex items-center" style={{ justifyContent: "space-between", gap: "0.5rem", marginTop: "0.85rem" }}>
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
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  flexShrink: 0,
                  color: filled ? "#fff" : "var(--color-text-secondary, #64748b)",
                  background: filled ? PRIMARY : "transparent",
                  border: filled
                    ? "1px solid " + PRIMARY
                    : "1px solid var(--color-border, #cbd5e1)",
                  // Active-step indicator: a secondary-colour ring around the circle.
                  boxShadow: active ? "0 0 0 2px var(--color-secondary, rgba(16,124,16,0.30))" : "none",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  className="pgr-step-title text-sm"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: active ? 600 : 500,
                    color: active ? PRIMARY : "var(--color-text-secondary, #64748b)",
                  }}
                >
                  {tr(t, "CS_CREATE_STEP_" + s.id.toUpperCase(), s.title)}
                </div>
                {s.sub ? (
                  <div
                    className="pgr-step-sub text-xs text-muted-foreground"
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {tr(t, "CS_CREATE_STEP_" + s.id.toUpperCase() + "_SUB", s.sub)}
                  </div>
                ) : null}
              </div>
            </div>
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
          .filter((o) => o?.active !== false && !!o?.code && !!o?.name && !!o?.tenantCode)
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    },
    { schemaCode: "PGR_COMPLAINT_RELATED_TO_MAP", tenantId: stateTenant }
  );
  const hasDispatcher = Array.isArray(relatedToOptions) && relatedToOptions.length > 0;

  // Catalogue tenant: the authority-resolved sub-tenant once picked, else the
  // base tenant (legacy). Changing it re-fetches the hierarchy at that tenant.
  const resolvedTenant = formData.resolvedTenantId || baseTenant;
  const caseRelatedTo = formData.caseRelatedTo;

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

  // Per-category templates (RAINMAKER-PGR.ComplaintTemplateType @ state tenant),
  // keyed by caseRelatedTo. Each points at a JSON Schema (schemaRef) + the
  // allowed evidence document types.
  const { data: templatesAll } = Digit.Hooks.useCustomMDMS(
    stateTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintTemplateType" }],
    {
      cacheTime: Infinity,
      select: (raw: any) =>
        (raw?.["RAINMAKER-PGR"]?.ComplaintTemplateType || []) as Array<{
          caseRelatedTo: string;
          active?: boolean;
          schemaRef?: string;
          allowedDocumentTypes?: string[];
        }>,
    },
    { schemaCode: "PGR_COMPLAINT_TEMPLATE_TYPE", tenantId: stateTenant }
  );
  // The per-category JSON Schemas (RAINMAKER-PGR.ComplaintExtendedAttributeSchema),
  // keyed by schemaRef — the FE renders the dynamic fields from these.
  const { data: schemasAll } = Digit.Hooks.useCustomMDMS(
    stateTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintExtendedAttributeSchema" }],
    {
      cacheTime: Infinity,
      select: (raw: any) => {
        const rows = (raw?.["RAINMAKER-PGR"]?.ComplaintExtendedAttributeSchema || []) as Array<{
          schemaRef: string;
          schema?: any;
        }>;
        const byRef: Record<string, any> = {};
        rows.forEach((r) => {
          if (r?.schemaRef) byRef[r.schemaRef] = r.schema;
        });
        return byRef;
      },
    },
    { schemaCode: "PGR_COMPLAINT_EXT_ATTR_SCHEMA", tenantId: stateTenant }
  );
  // Resolve the picked category → its template → its JSON Schema → renderable
  // fields (recomputes on category change without re-fetching). NOTE: every schema
  // field renders, incl. x-security ones — they are submitted in clear text until
  // the backend encryption phase lands.
  const { templateFields, evidenceDocType } = React.useMemo(() => {
    const entry = (templatesAll || []).find(
      (x: any) => x?.active !== false && x?.caseRelatedTo === caseRelatedTo
    );
    const schema = entry?.schemaRef ? (schemasAll || {})[entry.schemaRef] : null;
    return {
      templateFields: fieldsFromSchema(schema),
      evidenceDocType: (entry?.allowedDocumentTypes && entry.allowedDocumentTypes[0]) || "EVIDENCE",
    };
  }, [templatesAll, schemasAll, caseRelatedTo]);

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

  // Postal code was removed from the citizen flow (CCRS feedback): geocoder
  // pincodes are unreliable and the value is optional server-side.

  const stepIsValid = React.useMemo(() => {
    switch (curId) {
      case "complaint": {
        // Dispatcher (if seeded) must be answered, then a leaf complaint type.
        if (hasDispatcher && !formData.caseRelatedTo) return false;
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
        if (formData.caseRelatedTo && REQUIRED_CONSENTS.some((c) => !(formData.consents || []).includes(c.code))) {
          return false;
        }
        return true;
      }
      default:
        return true;
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
      const payload = mapFormDataToRequest(formData, resolvedTenant, user?.info ?? user, evidenceDocType);
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
        <p className="text-sm text-muted-foreground">
          {tr(t, "CS_FILE_COMPLAINT_SUBTITLE", "Provide details about your complaint")}
        </p>
        <style>{WIZARD_CSS}</style>
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
          {stepIndex === 0 ? (
            tr(t, "CS_COMMON_CANCEL", "Cancel")
          ) : (
            // Arrow glyphs sit above the text baseline when concatenated into the
            // label string — flex-center them against the text instead.
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
              {ArrowLeftIcon}
              <span>{t("BACK")}</span>
            </span>
          )}
        </Button>
        <Button
          variant="primary"
          onClick={handleContinue}
          loading={submitting}
          disabled={!stepIsValid}
          type="button"
        >
          {isLast ? (
            tr(t, "CS_SUBMIT_COMPLAINT", "Submit Complaint")
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
              <span>{t("NEXT")}</span>
              {ArrowRightIcon}
            </span>
          )}
        </Button>
      </FormFooter>
    </ScreenContainer>
  );
};

export default CreatePGRFlowV2;
