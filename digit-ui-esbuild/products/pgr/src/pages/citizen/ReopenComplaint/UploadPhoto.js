import React, { useEffect, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, SubmitBar } from "@egovernments/digit-ui-react-components";

import { LOCALIZATION_KEY } from "../../../constants/Localization";
import PgrFileUpload from "../../../components/PgrFileUpload";

// CCSD-2082:
//  - Issue 2: the reopen attachment step used ImageUploadHandler (images
//    only — camera icon). Reuse PgrFileUpload — the same drop-zone the citizen
//    create wizard and the employee action modals use — which accepts images
//    AND documents (PDF/DOC/DOCX, audio, video; 5 MB each) with a format hint.
//  - Issue 3: the "Pular e continuar" (Skip and continue) link is removed.
//    Attaching stays OPTIONAL (Issue 2 only asks to widen the accepted types,
//    not to require an attachment), so "Próximo" proceeds with or without a
//    file. The mandatory step is now the reason-details screen (AddtionalDetails).
const toDocument = (fileStoreId) => ({
  documentType: "PHOTO",
  fileStoreId,
  documentUid: fileStoreId,
  additionalDetails: {},
});

// CCSD-2082 Issue 2: accept images AND documents (PDF/DOC/DOCX) — and, per the
// follow-up, audio/video too (same set as the create wizard / action modals,
// CCSD-1971). Matches PgrFileUpload's default; kept explicit for clarity.
const REOPEN_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov,.avi,.mkv,.webm";

const UploadPhoto = (props) => {
  const { t } = useTranslation();
  const history = useHistory();
  const { id } = useParams();
  const [verificationDocuments, setVerificationDocuments] = useState(null);

  const tenantId = props?.complaintDetails?.service?.tenantId || Digit.ULBService.getCurrentTenantId();

  // Live value for the uploader's preview cards = the fileStoreIds we hold.
  const value = Array.isArray(verificationDocuments) ? verificationDocuments.map((d) => d.fileStoreId).filter(Boolean) : [];

  // PgrFileUpload reports (fieldKey, [fileStoreId,...]) on every add/remove.
  const onSelect = (_key, ids) => {
    setVerificationDocuments((ids || []).map(toDocument));
  };

  function next() {
    history.push(`${props.match.path}/addional-details/${id}`);
  }

  useEffect(() => {
    let reopenDetails = Digit.SessionStorage.get(`reopen.${id}`);
    Digit.SessionStorage.set(`reopen.${id}`, { ...reopenDetails, verificationDocuments });
  }, [verificationDocuments, id]);

  const header =
    t("CS_REOPEN_UPLOAD_HEADER") === "CS_REOPEN_UPLOAD_HEADER"
      ? "Attach documents or photos (optional)"
      : t("CS_REOPEN_UPLOAD_HEADER");
  // Hint mirrors the accepted types (images, PDF/DOC/DOCX, audio, video).
  const uploadHint =
    t("CS_REOPEN_UPLOAD_HINT") === "CS_REOPEN_UPLOAD_HINT"
      ? "JPG, PNG, PDF, DOC, DOCX, XLS, XLSX, MP4, MOV, AVI, MKV up to 5 MB each. You can upload up to 5 files."
      : t("CS_REOPEN_UPLOAD_HINT");

  return (
    <React.Fragment>
      <Card>
        <CardHeader>{header}</CardHeader>
        <PgrFileUpload
          t={t}
          tenantId={tenantId}
          fieldKey="ReopenDocuments"
          value={value}
          onSelect={onSelect}
          accept={REOPEN_ACCEPT}
          hint={uploadHint}
        />
        <SubmitBar label={t(`${LOCALIZATION_KEY.PT_COMMONS}_NEXT`)} onSubmit={next} />
      </Card>
    </React.Fragment>
  );
};

export default UploadPhoto;
