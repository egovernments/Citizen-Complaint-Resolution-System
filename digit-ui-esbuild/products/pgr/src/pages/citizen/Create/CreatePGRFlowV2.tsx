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
  t: (key: string) => string;
}

function Step0Type({ data, patch, serviceDefs, t }: StepBodyProps) {
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
        menuPathName: t("SERVICEDEFS." + s.menuPath.toUpperCase()),
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
                label: s.name ? t(s.name) : s.serviceCode,
              }))}
            />
          </Field>
        ) : null}
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
            // Mirror the pincode onto postalCode so the address step / submit
            // validation see the latest pin's pincode (matches FormExplorer.useEffect).
            postalCode:
              value?.pincode != null && String(value.pincode).length > 0
                ? String(value.pincode)
                : data.postalCode,
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
function Step2Location({ data, patch, t }: StepBodyProps) {
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
  // user gets a normal editable field.
  const pincodeFromMap = data?.GeoLocationsPoint?.pincode;
  const pincodeKnown =
    !!(pincodeFromMap != null && String(pincodeFromMap).length > 0) ||
    !!(data.postalCode && data.postalCode.length > 0);

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
            config={{ key: "SelectedBoundary", populators: { name: "SelectedBoundary" }, label: "" }}
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

  const { data: serviceDefs, isLoading: isMDMSLoading } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ServiceDefs" }],
    {
      cacheTime: Infinity,
      select: (raw: any) => raw?.["RAINMAKER-PGR"]?.ServiceDefs,
    },
    { schemaCode: "SERVICE_DEFS_MASTER_DATA" }
  );

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

  // Mirror map-derived pincode onto postalCode (matches FormExplorer's effect).
  React.useEffect(() => {
    const pin = formData?.GeoLocationsPoint?.pincode;
    const desired = pin != null && String(pin).length > 0 ? String(pin) : undefined;
    if (desired !== undefined && formData.postalCode !== desired) {
      setFormData((prev) => ({ ...prev, postalCode: desired }));
    }
  }, [formData?.GeoLocationsPoint?.pincode, formData.postalCode]);

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
    return true;
  }, [stepIndex, formData, serviceDefs]);

  function pincodeAllowlistOk(): boolean {
    const wardResolved = !!formData?.GeoLocationsPoint?.ward?.code;
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
    t,
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
