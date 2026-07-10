import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toast from "./Toast";
import UploadImages from "./UploadImages";

export const ImageUploadHandler = (props) => {
  const { t } = useTranslation();
  const [image, setImage] = useState(null);
  const [uploadedImagesThumbs, setUploadedImagesThumbs] = useState(null);
  const [uploadedImagesIds, setUploadedImagesIds] = useState(props.uploadedImages);

  const [rerender, setRerender] = useState(1);
  const [imageFile, setImageFile] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (image) {
      uploadImage();
    }
  }, [image]);

  useEffect(() => {
    if (!isDeleting) {
      (async () => {
        if (uploadedImagesIds !== null) {
          await submit();
          setRerender(rerender + 1);
          props.onPhotoChange(uploadedImagesIds);
        }
      })();
    } else {
      setIsDeleting(false)
      props.onPhotoChange(uploadedImagesIds);
    }
  }, [uploadedImagesIds]);

  useEffect(() => {
    if (imageFile && imageFile.size > 2097152) {
      setError(t("CS_FILE_TOO_LARGE") || "File is too large");
    } else {
      setImage(imageFile);
    }
  }, [imageFile]);

  // Auto-dismiss the upload error toast so a rejected file (too large /
  // unsupported) doesn't leave a banner stuck on screen forever (CCRS#923).
  // The toast also gets a manual close button (isDleteBtn below).
  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  const addUploadedImageIds = useCallback(
    (imageIdData) => {
      if (uploadedImagesIds === null) {
        var arr = [];
      } else {
        arr = uploadedImagesIds;
      }
      return [...arr, imageIdData.data.files[0].fileStoreId];
    },
    [uploadedImagesIds]
  );

  function getImage(e) {
    setError(null);
    setImageFile(e.target.files[0]);
  }

  const uploadImage = useCallback(async () => {
    // CCRS#555: filestore rejects unsupported formats (PDFs, SVG, etc.
    // depending on the tenant's ALLOWED_FORMATS_MAP). The previous code
    // had no error handling, so the rejection bubbled as an unhandled
    // promise — no toast, no preview update, leaving the user with no
    // indication that the upload had failed. Surface it as a Toast.
    try {
      const response = await Digit.UploadServices.Filestorage("property-upload", image, props.tenantId);
      setUploadedImagesIds(addUploadedImageIds(response));
    } catch (err) {
      const apiMessage =
        err?.response?.data?.Errors?.[0]?.message ||
        err?.response?.data?.message ||
        err?.message;
      setError(t("CS_FILE_UPLOAD_FAILED") || apiMessage || "File upload failed");
    }
  }, [addUploadedImageIds, image, t]);

  function addImageThumbnails(thumbnailsData) {
    var keys = Object.keys(thumbnailsData.data);
    var index = keys.findIndex((key) => key === "fileStoreIds");
    if (index > -1) {
      keys.splice(index, 1);
    }
    var thumbnails = [];
    // if (uploadedImagesThumbs !== null) {
    //   thumbnails = uploadedImagesThumbs.length > 0 ? uploadedImagesThumbs.filter((thumb) => thumb.key !== keys[0]) : [];
    // }

    const newThumbnails = keys.map((key) => {
      return { image: thumbnailsData.data[key].split(",")[2], key };
    });

    setUploadedImagesThumbs([...thumbnails, ...newThumbnails]);
  }

  const submit = useCallback(async () => {
    if (uploadedImagesIds !== null && uploadedImagesIds.length > 0) {
      const res = await Digit.UploadServices.Filefetch(uploadedImagesIds, props.tenantId);
      addImageThumbnails(res);
    }
  }, [uploadedImagesIds]);

  function deleteImage(img) {
    setIsDeleting(true);
    var deleteImageKey = uploadedImagesThumbs.filter((o, index) => o.image === img);

    var uploadedthumbs = uploadedImagesThumbs;
    var newThumbsList = uploadedthumbs.filter((thumbs) => thumbs != deleteImageKey[0]);

    var newUploadedImagesIds = uploadedImagesIds.filter((key) => key !== deleteImageKey[0].key);
    setUploadedImagesThumbs(newThumbsList);
    setUploadedImagesIds(newUploadedImagesIds);
    Digit.SessionStorage.set("PGR_CREATE_IMAGES", newUploadedImagesIds);
  }

  return (
    <React.Fragment>
      {error && <Toast error={true} label={error} isDleteBtn={true} onClose={() => setError(null)} />}
      <UploadImages onUpload={getImage} onDelete={deleteImage} thumbnails={uploadedImagesThumbs ? uploadedImagesThumbs.map((o) => o.image) : []} />
    </React.Fragment>
  );
};
