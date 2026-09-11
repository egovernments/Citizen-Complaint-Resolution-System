/* eslint-disable react/prop-types */
// "Download Application" — citizen surfaces only (complaint submitted screen and
// the citizen complaint detail page).
//
// The PDF is drawn locally from data already in memory (see utils/complaintReceipt),
// so it works on a dropped connection. The only network call is the optional
// tenant logo, which is fetched with a short timeout and simply omitted on
// failure rather than blocking or failing the download.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@egovernments/digit-ui-components-v2";

import { downloadComplaintReceipt, fetchLogoDataUri, RECEIPT_FALLBACKS } from "../utils/complaintReceipt";
import useComplaintReceiptModel from "../hooks/pgr/useComplaintReceiptModel";

// Logos are cached per URL for the session: the detail page and the success
// screen would otherwise refetch the same image on every click.
const logoCache = new Map();

// dd/MM/yyyy HH:mm, deliberately locale-neutral. ConvertEpochToDate gives the
// date half, but its time sibling emits an English AM/PM suffix, which would be
// the only untranslated token on an otherwise Portuguese document.
const stampNow = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${Digit.DateUtils.ConvertEpochToDate(now.getTime())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const getLogo = async (url) => {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url);
  const uri = await fetchLogoDataUri(url);
  logoCache.set(url, uri);
  return uri;
};

/**
 * Two ways to use this:
 *  - pass `complaintDetails` (the useComplaintDetails object) when the caller
 *    already has it, as the detail page does;
 *  - pass only `complaintId` + `tenantId` and it fetches the very same thing,
 *    which is what the success screen needs — it holds just the created
 *    ServiceWrapper, and printing that alone produced a near-empty receipt.
 */
/**
 * Outer shell: resolves the complaint record (fetching it when only an id was
 * given), and mounts the real button ONLY once the record exists.
 *
 * That mount gate is load-bearing, not cosmetic: useComplaintReceiptModel's
 * MDMS read switches useCustomMDMS between its v1/v2 branches depending on
 * whether the complaint's tenant is known. Those branches call different
 * hooks, so letting the tenant arrive MID-MOUNT (as it did on the success
 * screen, where only the id is available at mount) changes the hook order
 * between renders and crashes React ("Cannot read properties of undefined
 * (reading 'length')" from useMemo) the moment the fetch resolves. Splitting
 * the component guarantees every hook inside the inner button sees the tenant
 * from its very first render.
 */
const DownloadReceiptButton = ({
  complaintDetails: providedDetails,
  complaintId,
  tenantId,
  variant = "outline",
  onError,
}) => {
  const { t } = useTranslation();

  // Fetch only when the caller did not already supply the record — the same
  // hook, and therefore the same shape, the detail page renders from.
  const shouldFetch = !providedDetails && !!complaintId;
  const { complaintDetails: fetchedDetails, revalidate } = Digit.Hooks.pgr.useComplaintDetails({
    tenantId: tenantId || Digit.ULBService.getCurrentTenantId(),
    id: complaintId,
    enabled: shouldFetch,
  });
  const complaintDetails = providedDetails || fetchedDetails || null;

  // Right after a create, the complaint is not yet searchable (persistence is
  // asynchronous), so the first fetch legitimately resolves to an EMPTY record
  // and react-query caches it as a success — no retry will ever fire. Re-poll
  // a few times with backoff until the record appears; give up quietly after
  // that (the button just stays disabled).
  const attemptsRef = useRef(0);
  // `revalidate` is a fresh closure every render; go through a ref so the
  // effect's deps stay stable and a re-render can't re-arm (and burn) attempts.
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  useEffect(() => {
    if (!shouldFetch || complaintDetails?.service) return undefined;
    // Only poll once a fetch has actually resolved empty; each refetch yields a
    // new object identity, which is what re-fires this effect for the next try.
    if (!fetchedDetails || attemptsRef.current >= 5) return undefined;
    const attempt = (attemptsRef.current += 1);
    const timer = setTimeout(() => revalidateRef.current(), 1200 * attempt);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetch, fetchedDetails, complaintDetails?.service]);

  if (!complaintDetails?.service) {
    // Same visual as the ready button, disabled while the record loads.
    const label = t("PGR_RECEIPT_DOWNLOAD");
    return (
      <Button variant={variant} type="button" disabled leading={<Download className="h-4 w-4" />}>
        {label === "PGR_RECEIPT_DOWNLOAD" ? RECEIPT_FALLBACKS.downloadLabel : label}
      </Button>
    );
  }

  return <ReceiptButtonReady complaintDetails={complaintDetails} variant={variant} onError={onError} />;
};

// Inner button: every render of this component has the full record, so the
// hooks below run with a stable configuration for the component's lifetime.
const ReceiptButtonReady = ({ complaintDetails, variant, onError }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const { service, details, classification, extendedRows } = useComplaintReceiptModel(complaintDetails);

  const tr = useCallback(
    (key, fallback) => {
      const v = t(key);
      return v === key ? fallback : v;
    },
    [t]
  );

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const initData = Digit.SessionStorage.get("initData") || {};
      const stateInfo = initData.stateInfo || {};
      // The complaint's own tenant is the authority that owns it, which is not
      // necessarily the citizen's home city on a multi-authority deployment.
      const tenantCode = service?.tenantId;
      const tenant = (initData.tenants || []).find((x) => x?.code === tenantCode);
      // The tenant's own `name` is the source of truth. Some seeds set it to the
      // tenant CODE though ("bo"), which prints as a meaningless header, so in
      // that case fall through to the localized i18nKey (TENANT_TENANTS_<CODE>)
      // and then the state name. tr() returns "" for an unseeded key, so a
      // missing translation can never leak a raw key onto the document.
      const nameIsCode = (n) => !n || String(n).trim().toLowerCase() === String(tenantCode || "").trim().toLowerCase();
      const seededName = tenant?.name && !nameIsCode(tenant.name) ? tenant.name : "";
      const tenantName =
        seededName ||
        (tenant?.city?.name && !nameIsCode(tenant.city.name) ? tenant.city.name : "") ||
        (tenant?.i18nKey ? tr(tenant.i18nKey, "") : "") ||
        (stateInfo?.name && !nameIsCode(stateInfo.name) ? stateInfo.name : "") ||
        tenant?.name ||
        stateInfo?.name ||
        "";
      const logoDataUri = await getLogo(stateInfo?.logoUrl);
      // Same contact number the sidebar shows, so the citizen has somewhere to
      // call with the complaint number in hand.
      const helpline = tenant?.contactNumber || "";

      downloadComplaintReceipt({
        service,
        details,
        classification,
        extendedRows,
        tenantName,
        logoDataUri,
        helpline,
        generatedOn: stampNow(),
        t,
        tr,
      });
    } catch (e) {
      // Never leave the citizen with a dead button and no explanation.
      if (typeof onError === "function") {
        onError(tr("PGR_RECEIPT_ERROR", RECEIPT_FALLBACKS.errorLabel));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, service, details, classification, extendedRows, t, tr, onError]);

  return (
    <Button
      variant={variant}
      type="button"
      onClick={handleClick}
      loading={busy}
      leading={<Download className="h-4 w-4" />}
    >
      {tr("PGR_RECEIPT_DOWNLOAD", RECEIPT_FALLBACKS.downloadLabel)}
    </Button>
  );
};

export default DownloadReceiptButton;
