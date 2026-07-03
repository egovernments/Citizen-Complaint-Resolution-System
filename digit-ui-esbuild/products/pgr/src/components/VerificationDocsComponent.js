import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageUploadHandler } from "@egovernments/digit-ui-react-components";

// Generic verification-document uploader rendered inside the workflow action modal
// whenever the target state is flagged `docUploadRequired` on the BusinessService.
// Mirrors the FormComposerV2 component contract used by AssigneeComponent
// ({ config, onSelect } → onSelect(config.key, value)) so no per-action code is needed.
// The uploaded fileStoreIds are shaped into the same {documentType, fileStoreId, …}
// structure the citizen reopen flow uses, then written to `SelectedDocuments`, which
// handleActionSubmit maps onto workflow.verificationDocuments.
const VerificationDocsComponent = ({ config, onSelect }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const [ids, setIds] = useState(null);

  const handleUpload = (fileStoreIds) => {
    setIds(fileStoreIds);
    const documents = (fileStoreIds || []).map((id) => ({
      documentType: "PHOTO",
      fileStoreId: id,
      documentUid: id,
      additionalDetails: {},
    }));
    if (config?.key) onSelect(config.key, documents);
  };

  return (
    <div className="verification-docs-container">
      <ImageUploadHandler
        header={t(config?.label || "CS_UPLOAD_DOCUMENTS")}
        tenantId={tenantId}
        cardText=""
        onPhotoChange={handleUpload}
        uploadedImages={ids}
      />
    </div>
  );
};

export default VerificationDocsComponent;
