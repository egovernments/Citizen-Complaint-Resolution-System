import React, { useState } from "react";
import { FormStep, ImageUploadHandler } from "@egovernments/digit-ui-react-components";

const SelectImages = ({ t, config, formData, onSelect, onSkip, value = {} }) => {
  const [uploadedImages, setUploadedImagesIds] = useState(() => {
    return formData?.[config.key] || value?.uploadedImages || null;
  });

  // Get tenantId from the selected city in previous step (SelectAddress)
  const selectedCityCode = formData?.SelectAddress?.city?.code;
  const fallbackTenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  const tenantId = selectedCityCode || fallbackTenantId;

  const handleUpload = (ids) => {
    setUploadedImagesIds(ids);
    onSelect(config.key, ids);
  };

  const handleSubmit = () => {
    if (!uploadedImages || uploadedImages.length === 0) return onSkip();
    onSelect(config.key, uploadedImages);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <ImageUploadHandler
        tenantId={tenantId}
        uploadedImages={uploadedImages}
        onPhotoChange={handleUpload}
      />
    </div>
  );
};

export default SelectImages;
