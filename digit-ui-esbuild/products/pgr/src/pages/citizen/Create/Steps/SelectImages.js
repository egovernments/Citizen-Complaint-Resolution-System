import React, { useState } from "react";
import { FormStep, ImageUploadHandler } from "@egovernments/digit-ui-react-components";

const SelectImages = ({ t, config, formData, onSelect, onSkip, value = {} }) => {
  const [uploadedImages, setUploadedImagesIds] = useState(() => {
    return formData?.[config.key] || value?.uploadedImages || null;
  });

  // Get tenantId from the selected city in previous step (SelectAddress)
  const selectedCityCode = formData?.SelectAddress?.city?.code;
  const fallbackTenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code;
  const tenantId = selectedCityCode || fallbackTenantId || Digit.ULBService.getCurrentTenantId();

  const handleUpload = (ids) => {
    setUploadedImagesIds(ids);
    onSelect(config.key, ids);
  };

  const handleSubmit = () => {
    if (!uploadedImages || uploadedImages.length === 0) return onSkip();
    onSelect(config.key, uploadedImages);
  };

  return (
    <FormStep config={config} onSelect={handleSubmit} onSkip={onSkip} t={t}>
      <ImageUploadHandler
        tenantId={tenantId}
        uploadedImages={uploadedImages}
        onPhotoChange={handleUpload}
      />
    </FormStep>
  );
};

export default SelectImages;
