import React from "react";
import { useTranslation } from "react-i18next";
import PgrFileUpload from "./PgrFileUpload";

// Workflow-action attachment field (CCSD-1965) — thin FormComposerV2 adapter
// around the SAME enhanced uploader the citizen create wizard uses
// (PgrFileUpload: drag-drop zone, preview cards, remove, 5MB/file).
//
// Contract: renders in the generic action modal for EVERY workflow action;
// emits the ALREADY-SHAPED document array handleActionSubmit forwards as
// workflow.verificationDocuments.
const toDocument = (id) => ({
  documentType: "PHOTO",
  fileStoreId: id,
  documentUid: id,
  additionalDetails: {},
});

const ActionUploadComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  // Filestore is tenant-scoped: upload to the COMPLAINT's tenant (injected by
  // getUpdatedConfig as populators.tenantId) so a root-tenant admin acting on
  // a city complaint doesn't strand files where the display side (which reads
  // at service.tenantId) can't fetch them.
  const tenantId = config?.populators?.tenantId || Digit.ULBService.getCurrentTenantId();

  // Live form value (session-restored on modal reopen) → fileStoreIds; the
  // uploader rebuilds its preview cards from these via Filefetch.
  const existing = formData?.[config?.key];
  const value = Array.isArray(existing) ? existing.map((d) => d?.fileStoreId).filter(Boolean) : [];

  // Optional width cap (populators.maxWidth) so the drop zone lines up with the
  // capped input column when embedded in a full-page FormComposerV2 form.
  // Absent in the action modal → unchanged there.
  const maxWidth = config?.populators?.maxWidth;
  const uploader = (
    <PgrFileUpload
      t={t}
      tenantId={tenantId}
      fieldKey={config?.key || "SelectedDocuments"}
      value={value}
      compact
      onSelect={(key, ids) => onSelect(key, ids.map(toDocument))}
    />
  );
  return maxWidth ? <div style={{ maxWidth, width: "100%" }}>{uploader}</div> : uploader;
};

export default ActionUploadComponent;
