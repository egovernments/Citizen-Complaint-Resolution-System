/* eslint-disable @typescript-eslint/no-explicit-any */
// Citizen "File a Complaint": three steps, as in the #2038 design.
//
//   1. Complaint details: the description (typed, or spoken through the
//      browser's speech recognition), photos, and the category.
//   2. Location: the map pin (optional) and the boundary down to its last
//      level, postal code and landmark.
//   3. Review, then submit.
//
// What is unchanged: the request sent to /pgr/v1/_create (bar the locality,
// below), the category and boundary pickers, the map, the postal code and
// pincode-allowlist rules, and the response page's redux contract.
// All three steps stay mounted and only the current one shows, so going Back
// finds the pickers as the citizen left them.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { complaintLabel } from "../../../utils/complaintLabel";
import { isPostalCodeValid, getPostalCodeErrorMessage, isPostalCodeNumeric } from "../../../utils/postalCode";
import { serializeGeoLocation } from "../../../utils/geoLocation";
import { trackEvent } from "../../../utils/analytics";
import useVoiceInputEnabled from "../../../hooks/pgr/useVoiceInputEnabled";
import { useDispatch } from "react-redux";
import { useHistory } from "react-router-dom";
import { useQueryClient } from "react-query";

import { Button, ScreenContainer, ScreenHeader, Field, Input, Select, Textarea } from "@egovernments/digit-ui-components-v2";
import { MicButton, VoiceSheet, speechToTextSupported } from "./VoiceInput";
import { PhotoPicker, PickedPhoto } from "./PhotoPicker";

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
  /** Reverse-geocoded address, when the map found one. */
  address?: string | null;
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
}

/** The boundary picker's selection: the leaf, plus the node at each level. */
interface BoundaryLevel {
  code?: string;
  name?: string;
  boundaryType?: string;
}

const STEPS = [
  { id: "details", key: "CS_FILE_STEP_DETAILS", fallback: "Complaint Details" },
  { id: "location", key: "CS_FILE_STEP_LOCATION", fallback: "Location" },
  { id: "review", key: "CS_FILE_STEP_REVIEW", fallback: "Review" },
] as const;

/** The description's ceiling: eg_pgr_service_v2.description is varchar(4000). */
const DESCRIPTION_MAX = 4000;

// ---------------------------------------------------------------------------
// Helpers (kept identical to the legacy FormExplorer so the API payload
// shape is preserved byte-for-byte)
// ---------------------------------------------------------------------------

function validateString(v: unknown): string {
  return typeof v === "string" && v.trim().length > 0 ? v : "";
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
        // The ward the citizen confirmed in the cascade, which Review shows.
        // It is the map's ward whenever the map's ward is in the boundary
        // tree (the cascade fills from it); when the tree has no such ward,
        // or the citizen changed the cascade, the map's code was filed while
        // Review showed another ward.
        locality: {
          code:
            formData?.SelectedBoundary?.code ||
            formData?.GeoLocationsPoint?.ward?.code ||
            "",
        },
        geoLocation: serializeGeoLocation(geoLocation),
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
      // CCSD-1980 / #1226: reject numbers-only / whitespace-only descriptions
      // (e.g. "000000000000") — require at least 3 letters (any language).
      // Mirrors the employee-side rule in CreateComplaintConfig.js; this V2
      // flow (and the legacy FormExplorer it was ported from) only checked
      // non-empty, so a citizen could submit a numeric-only description even
      // though the employee UI already rejected it.
      return (
        typeof data.description === "string" &&
        /^(?=(?:[\s\S]*?\p{L}){3})[\s\S]+$/u.test(data.description)
      );
    case "SelectComplaintType":
      return data.SelectComplaintType != null;
    case "GeoLocationsPoint":
      return data.GeoLocationsPoint?.lat != null && data.GeoLocationsPoint?.lng != null;
    default:
      return (data as Record<string, unknown>)[fieldKey as string] != null;
  }
}

// ---------------------------------------------------------------------------
// Sub-step bodies
// ---------------------------------------------------------------------------

/** One of the step's grouped panels: a small heading over its fields. */
function Section({ title, className, children }: { title?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`cms-section${className ? ` ${className}` : ""}`}>
      {title ? <h2 className="cms-section-head">{title}</h2> : null}
      {children}
    </section>
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
    // Its levels sit in the step's field grid: side by side on desktop,
    // stacked on a phone.
    <div className="cms-hierarchy">
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
              // Every filing list searches, whatever its length, as the
              // employee form's do (CCRS#941).
              searchable
              searchPlaceholder={tr(t, "CS_COMMON_SEARCH", "Search")}
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

function CategoryFields({ data, patch, serviceDefs, hierarchyDef, nodes, t }: StepBodyProps) {
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
    <div className="cms-field-grid">
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
            label={tr(t, "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE", "Complaint Category")}
            required
            htmlFor="complaint-type"
          >
            <Select
              id="complaint-type"
              value={data.SelectComplaintType?.menuPath}
              searchable
              searchPlaceholder={tr(t, "CS_COMMON_SEARCH", "Search")}
              onValueChange={(value: string) => {
                const picked = types.find((tp) => tp.menuPath === value);
                patch({ SelectComplaintType: picked, SelectSubComplaintType: null });
              }}
              placeholder={tr(t, "CS_COMPLAINT_PICK_TYPE", "Select a complaint category")}
              options={types.map((tp) => ({
                value: tp.menuPath,
                label: tp.menuPathName ?? tp.menuPath,
              }))}
            />
          </Field>
          {subTypes.length > 1 ? (
            <Field
              label={tr(t, "CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE", "Complaint Subcategory")}
              required
              htmlFor="complaint-subtype"
            >
              <Select
                id="complaint-subtype"
                value={data.SelectSubComplaintType?.serviceCode}
                searchable
                searchPlaceholder={tr(t, "CS_COMMON_SEARCH", "Search")}
                onValueChange={(value: string) => {
                  const picked = subTypes.find((s) => s.serviceCode === value);
                  patch({ SelectSubComplaintType: picked });
                }}
                placeholder={tr(t, "CS_COMPLAINT_PICK_SUBTYPE", "Select a subcategory")}
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
  );
}

function MapPanel({ data, patch, t }: StepBodyProps) {
  // Reuse the existing GeoLocations component — it owns the leaflet map +
  // Nominatim integration. We just pass through formData and a setter.
  const GeoLocations = Digit?.ComponentRegistryService?.getComponent("GeoLocations");
  if (!GeoLocations) {
    return <p className="cms-field-error">Map component not registered.</p>;
  }
  return (
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
  );
}

/**
 * The boundary cascade, postal code and landmark under the map.
 *
 * The cascade auto-fills from the map pin (GeoLocations.resolveWard writes
 * the ward, BoundaryComponent rebuilds the path) and renders the filled
 * levels read-only; a level the auto-fill missed stays interactive so the
 * citizen can fill the gap. The postal code pre-fills from the pin too but
 * always stays editable.
 */
function LocationFields({ data, patch, t, tenantId }: StepBodyProps) {
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
    <div className="cms-field-grid">
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
        error={showPostalError ? getPostalCodeErrorMessage(t) : undefined}
      >
        <Input
          id="postal-code"
          type="text"
          // Numeric keyboard hint only when the configured pattern is
          // digit-only (KE 5, MZ 4, IN 6 — every real deployment today);
          // alnum/dash tenants (UK / US 5+4 examples in _example.yml) get
          // the full keyboard their pattern needs. No keystroke filtering
          // either way — the shared validator is the sole gate, so input
          // is never mangled before it reaches isPostalCodeValid().
          inputMode={isPostalCodeNumeric() ? "numeric" : "text"}
          pattern={isPostalCodeNumeric() ? "[0-9]*" : undefined}
          maxLength={16}
          invalid={showPostalError}
          value={effectivePincode}
          onChange={(e) => patch({ postalCode: e.target.value })}
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
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);
const CheckMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const PinGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

interface DetailsStepProps extends StepBodyProps {
  photos: PickedPhoto[];
  setPhotos: (updater: (prev: PickedPhoto[]) => PickedPhoto[]) => void;
  canSpeak: boolean;
  onVoice: () => void;
}

function DetailsStep(props: DetailsStepProps) {
  const { data, patch, t, tenantId, photos, setPhotos, canSpeak, onVoice } = props;
  const say = (key: string, fallback: string) => tr(t, key, fallback);
  return (
    <div className="cms-step-body">
      <Section className="cms-section-describe">
        <label className="cms-label" htmlFor="complaint-description">
          {say("CS_FILE_DESCRIBE", "Describe your complaint")} <span className="cms-required">*</span>
        </label>
        <div className={`cms-textarea-wrap${canSpeak ? " with-mic" : ""}`}>
          <Textarea
            id="complaint-description"
            className="cms-textarea"
            rows={6}
            maxLength={DESCRIPTION_MAX}
            placeholder={say("CS_FILE_DESCRIBE_PLACEHOLDER", "Type your complaint here…")}
            value={data.description ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
          />
          {canSpeak ? <MicButton label={say("CS_VOICE_RECORD", "Record your complaint")} onClick={onVoice} /> : null}
        </div>
        <div className="cms-counter">
          {(data.description ?? "").length} / {DESCRIPTION_MAX}
        </div>
      </Section>
      <Section title={say("CS_FILE_PHOTO", "Upload a photo")} className="cms-section-photos">
        <PhotoPicker photos={photos} onChange={setPhotos} tenantId={tenantId || ""} tr={say} />
      </Section>
      <Section title={say("CS_FILE_CATEGORY", "Complaint category")} className="cms-section-category">
        <CategoryFields {...props} />
      </Section>
    </div>
  );
}

function LocationStep(props: StepBodyProps) {
  const { data, t } = props;
  const point = data.GeoLocationsPoint;
  const pinned = point?.lat != null && point?.lng != null;
  const coords = pinned ? `${Number(point?.lat).toFixed(5)}, ${Number(point?.lng).toFixed(5)}` : "";
  return (
    <div className="cms-step-body cms-location-body">
      <Section title={tr(t, "CS_FILE_STEP_LOCATION", "Location")} className="cms-section-map">
        <p className="cms-section-hint">
          {tr(t, "CS_PIN_LOCATION_HINT", "Drop a pin on the exact spot — we'll use it to route your complaint to the right ward.")}
        </p>
        <div className="cms-map">
          <MapPanel {...props} />
        </div>
        <div className="cms-pin-summary">
          <span className={`cms-pin-icon${pinned ? " pinned" : ""}`}>
            <PinGlyph />
          </span>
          <span className="cms-pin-text">
            <span className="cms-pin-title">
              {pinned
                ? tr(t, "CS_FILE_PINNED", "Pinned location")
                : tr(t, "CS_FILE_NOT_PINNED", "No location pinned yet (Optional)")}
            </span>
            <span className="cms-pin-meta">
              {pinned ? point?.address || coords : tr(t, "CS_FILE_PIN_HINT", "Search, drag the map, or use current location")}
            </span>
          </span>
        </div>
      </Section>
      <Section className="cms-section-address">
        <LocationFields {...props} />
      </Section>
    </div>
  );
}

const truncate = (text: string, max: number) => {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
};

/** Category and sub-category names for the chosen type, as the pickers show them. */
function categoryNames(data: FormData, t: (k: string) => string): { category: string; subCategory: string } {
  const main = data.SelectComplaintType;
  const sub = data.SelectSubComplaintType || main;
  if (!main) return { category: "", subCategory: "" };
  // A leaf with a parent reads "parent · leaf"; a type picked at its own
  // (terminal) level has no sub-category.
  const hasParent = !!main.menuPath && main.menuPath !== sub?.serviceCode;
  return {
    category: hasParent ? complaintLabel(t, main.menuPath, main.menuPathName) : complaintLabel(t, sub?.serviceCode, sub?.name),
    subCategory: hasParent && sub ? complaintLabel(t, sub.serviceCode, sub.name) : "",
  };
}

/** "Ward, Sub County, County, 00100": the boundary levels leaf first, then postal code. */
function addressLine(data: FormData, t: (k: string) => string): string {
  const levels: BoundaryLevel[] = (data.SelectedBoundary?.levels as BoundaryLevel[]) || [];
  // Named as the cascade's dropdowns name them: the code's translation, else
  // the node's own name, so an unlocalised tenant does not read raw codes.
  const names = levels
    .slice()
    .reverse()
    .map((level) => {
      if (!level.code) return "";
      const translated = t(level.code);
      return translated && translated !== level.code ? translated : level.name || level.code;
    })
    .filter(Boolean);
  const postal = data.postalCode ?? (data.GeoLocationsPoint?.pincode != null ? String(data.GeoLocationsPoint.pincode) : "");
  return [...names, postal].filter(Boolean).join(", ");
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cms-review-card">
      <h3 className="cms-review-head">{title}</h3>
      {children}
    </section>
  );
}

function ReviewRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="cms-review-rows">
      {rows.map(([label, value]) => (
        <div key={label} className="cms-review-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewStep({ data, t, photos }: StepBodyProps & { photos: PickedPhoto[] }) {
  const say = (key: string, fallback: string) => tr(t, key, fallback);
  const notProvided = say("CS_FILE_NOT_PROVIDED", "Not provided");
  const notSelected = say("CS_FILE_NOT_SELECTED", "Not selected");
  const { category, subCategory } = categoryNames(data, t);
  const attached = photos.filter((p) => p.status === "done");
  const point = data.GeoLocationsPoint;
  const pinned = point?.lat != null && point?.lng != null;
  const user = Digit.UserService.getUser()?.info;

  return (
    <div className="cms-step-body cms-review-body">
      <h2 className="cms-review-heading">{say("CS_FILE_REVIEW_HEADING", "Review before you submit")}</h2>
      <ReviewCard title={say("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS", "Complaint details")}>
        <ReviewRows
          rows={[
            [say("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION", "Description"), data.description?.trim() ? truncate(data.description, 180) : notProvided],
            [say("CS_FILE_CATEGORY_LABEL", "Complaint Category"), category || notSelected],
            // A type with no sub-types has nothing to select here.
            [say("CS_FILE_SUBCATEGORY_LABEL", "Complaint Subcategory"), subCategory || (category ? "—" : notSelected)],
            [
              say("CS_FILE_PHOTOS", "Photos"),
              attached.length
                ? say("CS_FILE_PHOTOS_ATTACHED", "{count} attached").replace("{count}", String(attached.length))
                : say("CS_FILE_NO_PHOTOS", "None attached"),
            ],
          ]}
        />
      </ReviewCard>
      <ReviewCard title={say("CS_FILE_STEP_LOCATION", "Location")}>
        <ReviewRows
          rows={[
            [say("CS_FILE_ADDRESS", "Address"), addressLine(data, t) || notProvided],
            [say("CS_COMPLAINT_LANDMARK__DETAILS", "Landmark"), data.landmark?.trim() ? truncate(data.landmark, 60) : notProvided],
            [
              say("CS_FILE_PIN_DROP", "Location"),
              pinned
                ? point?.address || `${Number(point?.lat).toFixed(5)}, ${Number(point?.lng).toFixed(5)}`
                : say("CS_FILE_NOT_CAPTURED", "Not captured"),
            ],
          ]}
        />
      </ReviewCard>
      {attached.length ? (
        <ReviewCard title={say("CS_FILE_ATTACHMENTS", "Attachments")}>
          <ul className="cms-attachments">
            {attached.map((photo) => (
              <li key={photo.id} className="cms-attachment">
                <img src={photo.previewUrl} alt="" />
                <span className="cms-attachment-name">{photo.name}</span>
              </li>
            ))}
          </ul>
        </ReviewCard>
      ) : null}
      <ReviewCard title={say("CS_FILE_COMPLAINANT", "Complainant details")}>
        <ReviewRows
          rows={[
            [say("CORE_COMMON_NAME", "Name"), user?.name || notProvided],
            [say("CORE_COMMON_MOBILE_NUMBER", "Phone number"), user?.mobileNumber || notProvided],
          ]}
        />
      </ReviewCard>
    </div>
  );
}

/** Desktop: the numbered stepper at the top of the card. Done steps go back. */
function FlowStepper({ index, t, onGo }: { index: number; t: (k: string) => string; onGo: (i: number) => void }) {
  return (
    <nav className="cms-stepper" aria-label={tr(t, "CS_FILE_PROGRESS", "Progress")}>
      <ol>
        {STEPS.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "todo";
          return (
            <li key={step.id} className={`cms-step ${state}`}>
              <button
                type="button"
                className="cms-step-mark"
                disabled={i >= index}
                aria-current={i === index ? "step" : undefined}
                onClick={() => onGo(i)}
                data-analytics-event={`pgr.file-complaint.stepper.${step.id}`}
              >
                <span className="cms-step-dot">{i < index ? <CheckMark /> : i + 1}</span>
                <span className="cms-step-label">{tr(t, step.key, step.fallback)}</span>
              </button>
              {i < STEPS.length - 1 ? <span className={`cms-step-line${i < index ? " done" : ""}`} aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Phone: "Step 1 of 3 · Complaint Details", what comes next, and a bar per step. */
function FlowStrip({ index, t }: { index: number; t: (k: string) => string }) {
  const current = STEPS[index];
  const next = STEPS[index + 1];
  const stepOf = tr(t, "CS_FILE_STEP_OF", "Step {current} of {total}")
    .replace("{current}", String(index + 1))
    .replace("{total}", String(STEPS.length));
  return (
    <div className="cms-strip">
      <div className="cms-strip-row">
        <span className="cms-strip-heading">
          {stepOf} · {tr(t, current.key, current.fallback)}
        </span>
        <span className="cms-strip-next">
          {next
            ? tr(t, "CS_FILE_NEXT_STEP", "Next: {step}").replace("{step}", tr(t, next.key, next.fallback))
            : tr(t, "CS_FILE_CHECK_SUBMIT", "Check and submit")}
        </span>
      </div>
      <div className="cms-strip-bars" aria-hidden="true">
        {STEPS.map((step, i) => (
          <span key={step.id} className={i <= index ? "on" : ""} />
        ))}
      </div>
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

  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const tenants: any = Digit.Hooks.pgr.useTenants();

  // Mount the MDMS validation mirror: fetches common-masters.FormValidations
  // (and MobileNumberValidation) and publishes the tenant's postalCode rule to
  // window.__DIGIT_FORM_VALIDATIONS — the channel isPostalCodeValid() /
  // getPostalCodeErrorMessage() read FIRST. Without this, the v2 flow would
  // silently keep validating against the globalConfigs fallback while the
  // employee form honours the (higher-precedence) MDMS row.
  Digit.Hooks.pgr.useMobileValidation(tenantId);

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
  const [photos, setPhotos] = React.useState<PickedPhoto[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  // The location step mounts on its first visit and then stays, so the map
  // and the boundary cascade keep what the citizen picked when they go Back.
  const [locationVisited, setLocationVisited] = React.useState(false);
  // The browser has to support speech, and the tenant mustn't have turned
  // voice off (RAINMAKER-PGR.UIConstants.VOICE_INPUT: false).
  const browserCanSpeak = React.useMemo(() => speechToTextSupported(), []);
  const voiceEnabled = useVoiceInputEnabled(tenantId);
  const canSpeak = browserCanSpeak && voiceEnabled;

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


  const updatePhotos = React.useCallback(
    (updater: (prev: PickedPhoto[]) => PickedPhoto[]) => setPhotos(updater),
    []
  );
  const uploading = photos.some((p) => p.status === "uploading");
  // A photo that did not upload holds the step until it is retried or
  // removed: the citizen believes it is attached, and it would be dropped.
  const uploadFailed = photos.some((p) => p.status === "failed");

  // Step 1: a description with at least three letters, and a complaint type.
  // Sub-type is conditionally mandatory: if the chosen type has sub-services in
  // the same menuPath, one must be picked (the legacy FormExplorer rule).
  const descriptionOk = isFieldValid(formData, "description");
  const categoryOk = React.useMemo(() => {
    if (!isFieldValid(formData, "SelectComplaintType")) return false;
    const mainPath = formData.SelectComplaintType?.menuPath;
    const subTypeOptions = (Array.isArray(serviceDefs) ? serviceDefs : []).filter(
      (s: ServiceDef) => s.menuPath === mainPath
    );
    return !(subTypeOptions.length > 1 && !formData.SelectSubComplaintType);
  }, [formData, serviceDefs]);

  // Step 2: the boundary down to its leaf, and a postal code that is either
  // empty (it is optional) or matches the tenant's configured shape (CCRS#722).
  const locationOk = isFieldValid(formData, "SelectedBoundary");
  const postalOk = isPostalCodeValid(formData.postalCode ?? formData?.GeoLocationsPoint?.pincode);

  const stepIsValid =
    stepIndex === 0
      ? descriptionOk && categoryOk && !uploading && !uploadFailed
      : stepIndex === 1
      ? locationOk && postalOk
      : true;

  /** Why Next is held, in the words the design uses. */
  const hint = (() => {
    if (stepIndex === 0) {
      if (!(formData.description ?? "").trim()) return tr(t, "CS_FILE_HINT_DESCRIBE", "Describe your complaint to continue.");
      if (!descriptionOk) return tr(t, "CS_FILE_HINT_LETTERS", "Use at least three letters to describe the complaint.");
      if (!categoryOk) return tr(t, "CS_FILE_HINT_CATEGORY", "Select a complaint category and subcategory to continue.");
      if (uploading) return tr(t, "CS_FILE_HINT_UPLOADING", "Wait for your photos to finish uploading.");
      if (uploadFailed) return tr(t, "CS_FILE_HINT_UPLOAD_FAILED", "A photo didn't upload. Retry it or remove it.");
    }
    if (stepIndex === 1) {
      if (!locationOk) return tr(t, "CS_FILE_HINT_LOCATION", "Select every level of the location to continue.");
      if (!postalOk) return getPostalCodeErrorMessage(t);
    }
    return "";
  })();

  // Coming back to the map: Leaflet sized itself while hidden, and redraws on
  // a window resize.
  React.useEffect(() => {
    if (stepIndex !== 1) return undefined;
    const id = window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => window.cancelAnimationFrame(id);
  }, [stepIndex]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0 });
    // The app scrolls inside .body-container rather than the window.
    document.querySelector(".body-container")?.scrollTo({ top: 0 });
  };

  function pincodeAllowlistOk(): boolean {
    const wardResolved =
      !!formData?.GeoLocationsPoint?.ward?.code || !!formData?.SelectedBoundary?.code;
    if (wardResolved) return true; // ward routing supersedes pincode allowlist (CCRS#469)
    if (!formData.postalCode || String(formData.postalCode).length === 0) return true;
    // Case-fold (postal codes may be alnum now, e.g. "sw1a 1aa" vs the
    // seeded "SW1A 1AA") and strip leading zeros only for purely numeric
    // values — "0100" ≡ "100" for a numeric pincode, but a leading zero in
    // an alnum code is significant.
    const norm = (v: unknown) => {
      const s = String(v ?? "").trim().toUpperCase();
      return /^[0-9]+$/.test(s) ? s.replace(/^0+/, "") || "0" : s;
    };
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
    if (!stepIsValid || submitting) return;
    if (isLast) {
      if (!pincodeAllowlistOk()) {
        setError(t("CS_COMMON_PINCODE_NOT_SERVICABLE"));
        return;
      }
      setSubmitting(true);
      const user = Digit.UserService.getUser();
      const fileStoreIds = photos
        .filter((p) => p.status === "done" && p.fileStoreId)
        .map((p) => p.fileStoreId as string);
      const payload = mapFormDataToRequest({ ...formData, ComplaintImagesPoint: fileStoreIds }, tenantId, user?.info ?? user);
      // What the confirmation screen summarises, handed over in the route's
      // state: the create response carries only codes, and the names are known
      // here. Route state survives the response page remounting.
      const names = categoryNames(formData, t);
      const filedSummary = {
        category: [names.category, names.subCategory].filter(Boolean).join(" · "),
        location: addressLine(formData, t),
        photos: fileStoreIds.length,
        filedAt: Date.now(),
      };
      createMutation(payload, {
        onError: () => {
          // Outcome, not intent. The submit click is already tagged; whether the
          // complaint was actually created happens later and a click listener
          // cannot see it. Without this pair the funnel ends at "pressed submit".
          trackEvent("pgr.file-complaint.submit-failed", { category: "pgr" });
          dispatch({ type: "CREATE_COMPLAINT", payload: { responseInfo: { status: "failed" } } });
          setSubmitting(false);
          history.push(`/${window?.contextPath}/citizen/pgr/response`);
        },
        onSuccess: async (responseData: any) => {
          trackEvent("pgr.file-complaint.submitted", { category: "pgr" });
          dispatch({ type: "CREATE_COMPLAINT", payload: responseData });
          await client.refetchQueries(["complaintsList"]);
          setSubmitting(false);
          history.push(`/${window?.contextPath}/citizen/pgr/response`, { filedSummary });
        },
      });
      return;
    }
    const next = stepIndex + 1;
    if (next === 1) setLocationVisited(true);
    setStepIndex(next);
    scrollToTop();
  }

  function handleBack() {
    if (submitting) return;
    // On the first step Back leaves the flow, as Cancel did; nothing else on
    // the page does now.
    if (stepIndex === 0) {
      history.goBack();
      return;
    }
    setStepIndex((i) => i - 1);
    scrollToTop();
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
  const say = (key: string, fallback: string) => tr(t, key, fallback);
  const appendSpoken = (text: string) => {
    const prev = (formData.description ?? "").trim();
    patch({ description: (prev ? `${prev} ${text}` : text).slice(0, DESCRIPTION_MAX) });
  };

  return (
    <ScreenContainer className="cms-file">
      <div className="cms-file-title">
        <ScreenHeader title={say("CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")} />
      </div>
      <div className="cms-file-card">
        <FlowStepper
          index={stepIndex}
          t={t}
          onGo={(i) => {
            if (i < stepIndex && !submitting) {
              setStepIndex(i);
              scrollToTop();
            }
          }}
        />
        <FlowStrip index={stepIndex} t={t} />
        <div className={`cms-file-body is-${STEPS[stepIndex]?.id}`}>
          <div className={`cms-step-pane${stepIndex === 0 ? "" : " is-hidden"}`}>
            <DetailsStep
              {...stepProps}
              photos={photos}
              setPhotos={updatePhotos}
              canSpeak={canSpeak}
              onVoice={() => setVoiceOpen(true)}
            />
          </div>
          {locationVisited ? (
            <div className={`cms-step-pane${stepIndex === 1 ? "" : " is-hidden"}`}>
              <LocationStep {...stepProps} />
            </div>
          ) : null}
          {stepIndex === 2 ? <ReviewStep {...stepProps} photos={photos} /> : null}
          {error ? (
            <div role="alert" className="cms-file-error">
              {error}
            </div>
          ) : null}
        </div>
        <div className="cms-footer">
          {hint ? (
            <p className="cms-hint" aria-live="polite">
              {hint}
            </p>
          ) : null}
          <div className="cms-footer-actions">
            {/* Analytics (CCRS#2007). Named from the step's stable STEPS id rather
                than stepIndex, so inserting or reordering a step cannot silently
                re-point an existing funnel step in the reports. */}
            <Button
              variant="outline"
              className="cms-back"
              onClick={handleBack}
              disabled={submitting}
              aria-label={say("CS_COMMON_BACK", "Back")}
              leading={<ChevronLeft />}
              data-analytics-event={
                stepIndex === 0 ? "pgr.file-complaint.cancel" : `pgr.file-complaint.back.${STEPS[stepIndex]?.id ?? "unknown"}`
              }
            >
              <span className="cms-back-label">{say("CS_COMMON_BACK", "Back")}</span>
            </Button>
            <Button
              variant="primary"
              className="cms-next"
              onClick={handleContinue}
              disabled={!stepIsValid}
              loading={submitting}
              trailing={<ArrowRight />}
              data-analytics-event={isLast ? "pgr.file-complaint.submit" : `pgr.file-complaint.${STEPS[stepIndex]?.id ?? "unknown"}`}
            >
              {isLast ? say("CS_ADDCOMPLAINT_ADDITIONAL_DETAILS_SUBMIT_COMPLAINT", "Submit complaint") : say("CS_COMMON_NEXT", "Next")}
            </Button>
          </div>
        </div>
      </div>
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} onUse={appendSpoken} tr={say} />
    </ScreenContainer>
  );
};

export default CreatePGRFlowV2;
