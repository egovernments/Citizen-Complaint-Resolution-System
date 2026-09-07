/* eslint-disable react/prop-types */
// "Download Receipt" — citizen surfaces only (complaint submitted screen and
// the citizen complaint detail page).
//
// The PDF is drawn locally from data already in memory (see utils/complaintReceipt),
// so it works on a dropped connection. The only network call is the optional
// tenant logo, which is fetched with a short timeout and simply omitted on
// failure rather than blocking or failing the download.

import React, { useCallback, useState } from "react";
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
const DownloadReceiptButton = ({
  complaintDetails: providedDetails,
  complaintId,
  tenantId,
  variant = "outline",
  onError,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // Fetch only when the caller did not already supply the record — the same
  // hook, and therefore the same shape, the detail page renders from.
  const shouldFetch = !providedDetails && !!complaintId;
  const { complaintDetails: fetchedDetails } = Digit.Hooks.pgr.useComplaintDetails({
    tenantId: tenantId || Digit.ULBService.getCurrentTenantId(),
    id: complaintId,
    enabled: shouldFetch,
  });
  const complaintDetails = providedDetails || fetchedDetails || null;

  const { service, details, classification, extendedRows } = useComplaintReceiptModel(complaintDetails);

  const tr = useCallback(
    (key, fallback) => {
      const v = t(key);
      return v === key ? fallback : v;
    },
    [t]
  );

  const handleClick = useCallback(async () => {
    if (busy || !service) return;
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
      disabled={!service}
      leading={<Download className="h-4 w-4" />}
    >
      {tr("PGR_RECEIPT_DOWNLOAD", RECEIPT_FALLBACKS.downloadLabel)}
    </Button>
  );
};

export default DownloadReceiptButton;
