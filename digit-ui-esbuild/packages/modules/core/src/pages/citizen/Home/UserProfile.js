import { DEFAULT_MOBILE_PREFIX } from "@egovernments/digit-ui-libraries";
import {
  SVG,
  Dropdown,
  LabelFieldPair,
  MobileNumber,
  TextInput,
  CardLabelError,
  BackLink,
  Loader,
  Button,
  SubmitBar,
  Footer,
  CardLabel,
  BreadCrumb,
  Toast,
  ErrorMessage,
} from "@egovernments/digit-ui-components";
import { CameraIcon, ToggleSwitch } from "@egovernments/digit-ui-react-components";
import {
  Button as V2Button,
  Card as V2Card,
  Field as V2Field,
  Input as V2Input,
  Select as V2Select,
} from "@egovernments/digit-ui-components-v2";
import { Camera, Phone, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import UploadDrawer from "./ImageUpload/UploadDrawer";
import ImageComponent from "../../../components/ImageComponent";

const DEFAULT_TENANT = Digit?.ULBService?.getStateId?.();

const defaultImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAO4AAADUCAMAAACs0e/bAAAAM1BMVEXK0eL" +
  "/" +
  "/" +
  "/" +
  "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";

const defaultValidationConfig = {
  tenantId: `${DEFAULT_TENANT}`,
  UserProfileValidationConfig: [
    {
      // Permit digits + apostrophes / hyphens / periods alongside letters
      // and spaces. The naipepea seed populates `name` with the user's
      // mobile number, so the original `/^[a-zA-Z ]+$/i` blocked save on
      // an unmodified Edit Profile (CCRS#556). Real-world names can also
      // contain "O'Brien" / "Mary-Anne" / "John Jr." which the
      // alpha-only regex rejected too.
      name: "/^[a-zA-Z0-9 .'\\-]+$/i",
      mobileNumber: "/^[6-9]{1}[0-9]{9}$/",
      password: "/^([a-zA-Z0-9@#$%]{8,15})$/i",
    },
  ],
};

const PREFERENCE_CODE = "USER_NOTIFICATION_PREFERENCES";

const UserProfile = ({ stateCode, userType, cityDetails }) => {
  const history = useHistory();
  const { t } = useTranslation();
  const url = window.location.href;
  const stateId = Digit.ULBService.getStateId();
  const tenant = Digit.ULBService.getCurrentTenantId();
  const userInfo = Digit.UserService.getUser()?.info || {};
  const [userDetails, setUserDetails] = useState(null);
  const [name, setName] = useState(userInfo?.name ? userInfo.name : "");
  const [email, setEmail] = useState(userInfo?.emailId ? userInfo.emailId : "");
  const [gender, setGender] = useState(userDetails?.gender);
  const [city, setCity] = useState(userInfo?.permanentCity ? userInfo.permanentCity : cityDetails.name);
  const [mobileNumber, setMobileNo] = useState(userInfo?.mobileNumber ? userInfo.mobileNumber : "");
  const [profilePic, setProfilePic] = useState(null);
  const [profileImg, setProfileImg] = useState("");
  const [openUploadSlide, setOpenUploadSide] = useState(false);
  const [changepassword, setChangepassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [windowWidth, setWindowWidth] = React.useState(window.innerWidth);
  const [errors, setErrors] = React.useState({});
  const isMobile = window.Digit.Utils.browser.isMobile();
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();

  const [notificationConsent, setNotificationConsent] = useState({
    SMS: { scope: "GLOBAL", status: "REVOKED" },
    EMAIL: { scope: "GLOBAL", status: "REVOKED" },
    WHATSAPP: { scope: "GLOBAL", status: "REVOKED" },
  });
  const [preferredLanguage, setPreferredLanguage] = useState(Digit.StoreData.getCurrentLanguage() || "en_IN");

  const availableLanguages = Digit.SessionStorage.get("initData")?.languages;

  const mapConfigToRegExp = (config) => {
    return (
      config?.UserProfileValidationConfig?.[0] &&
      Object.entries(config?.UserProfileValidationConfig[0]).reduce((acc, [key, value]) => {
        if (typeof value === "string") {
          try {
            // Checking if value looks like a regex (starts with "/" and ends with "/flags")
            if (value.startsWith("/") && value.lastIndexOf("/") > 0) {
              const lastSlashIndex = value.lastIndexOf("/");
              const pattern = value.slice(1, lastSlashIndex); // Extracting regex pattern
              const flags = value.slice(lastSlashIndex + 1); // Extracting regex flags

              acc[key] = new RegExp(pattern, flags); // Converting properly
            } else {
              acc[key] = new RegExp(value); // Treating it as a normal regex pattern (no flags)
            }
          } catch (error) {
            console.error(`Error parsing regex for key "${key}":`, error);
            acc[key] = value; // Keeping as string if invalid regex
          }
        } else {
          acc[key] = value; // Keeping non-string values as it is
        }
        return acc;
      }, {})
    );
  };

  const [validationConfig, setValidationConfig] = useState(mapConfigToRegExp(defaultValidationConfig) || {});

  const stateLvlTenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const moduleName = Digit?.Utils?.getConfigModuleName?.() || "commonUiConfig";

  // User Preferences - fetch enable flag from MDMS v2
  const { data: enableUserPreferences } = Digit.Hooks.useCustomMDMS(
    stateLvlTenantId,
    "commonUiConfig",
    [{ name: "UserPreferencesConfig" }],
    {
      select: (data) => data?.commonUiConfig?.UserPreferencesConfig?.[0]?.enableUserPreferences,
    },
    { schemaCode: "commonUiConfig.UserPreferencesConfig" }
  );

  const { data: preferenceData, isLoading: isPreferenceLoading } = Digit.Hooks.useCustomAPIHook({
    url: "/user-preference/v1/_search",
    body: {
      criteria: {
        userId: userInfo?.uuid,
        tenantId: tenant,
        preferenceCode: PREFERENCE_CODE,
      },
    },
    changeQueryName: "user_preference_search",
    config: {
      enabled: !!userInfo?.uuid && (userType === "citizen" || isMultiRootTenant) && !!enableUserPreferences,
      select: (data) => data?.preferences?.[0],
      cacheTime: 0,
      staleTime: 0,
    },
  });

  const preferenceUpsertMutation = Digit.Hooks.useCustomAPIMutationHook({
    url: "/user-preference/v1/_upsert",
  });

  useEffect(() => {
    if (preferenceData?.payload) {
      const consent = preferenceData.payload.consent || {};
      setNotificationConsent((prev) => ({
        SMS: consent.SMS || prev.SMS,
        EMAIL: consent.EMAIL || prev.EMAIL,
        WHATSAPP: consent.WHATSAPP || prev.WHATSAPP,
      }));
      if (preferenceData.payload.preferredLanguage) {
        setPreferredLanguage(preferenceData.payload.preferredLanguage);
      }
    }
  }, [preferenceData]);

  // Fetch enabled notification channels from config-service
  const { data: channelConfigData } = Digit.Hooks.useCustomAPIHook({
    url: "/config-service/config/v1/_search",
    body: {
      criteria: {
        schemaCode: "NotificationChannel",
        tenantId: tenant,
      },
    },
    changeQueryName: "config_service_search",
    config: {
      enabled: !!enableUserPreferences && !!tenant,
      select: (data) => {
        const channels = {};
        data?.configData?.forEach((item) => {
          channels[item.uniqueIdentifier] = item.data?.enabled === true;
        });
        return channels;
      },
    },
  });

  const handleConsentToggle = (channel) => {
    setNotificationConsent((prev) => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        status: prev[channel].status === "GRANTED" ? "REVOKED" : "GRANTED",
      },
    }));
  };

  const saveUserPreferences = async () => {
    try {
      await preferenceUpsertMutation.mutateAsync({
        body: {
          preference: {
            userId: userInfo?.uuid,
            tenantId: tenant,
            preferenceCode: PREFERENCE_CODE,
            payload: {
              consent: notificationConsent,
              preferredLanguage: preferredLanguage,
            },
          },
        },
      });
    } catch (error) {
      throw JSON.stringify({
        type: "error",
        message: error?.response?.data?.Errors?.[0]?.description || "CORE_COMMON_PROFILE_PREFERENCE_UPDATE_ERROR",
      });
    }
  };

  // Read from the canonical `ValidationConfigs.mobileNumberValidation`
  // schema — same swap we made in HRMS create/edit (#415/#420) and the
  // citizen login (#429). Nai Pepea doesn't seed the legacy
  // `commonUiConfig.UserValidation` master, so the profile page fell
  // through to the India default regex and refused to save Kenyan
  // mobile numbers on submit (closes egovernments/CCRS#444 sub-3).
  const { data: mdmsValidationData, isValidationConfigLoading } = Digit.Hooks.useCustomMDMS(
    stateLvlTenantId,
    "ValidationConfigs",
    [{ name: "mobileNumberValidation" }],
    {
      select: (data) => {
        const validationData = data?.ValidationConfigs?.mobileNumberValidation?.find(
          (x) => x.validationName === "defaultMobileValidation"
        );
        const rules = validationData?.rules;
        return {
          UserProfileValidationConfig: [
            {
              mobileNumber: rules?.pattern,
            },
          ],
          prefix: rules?.prefix || DEFAULT_MOBILE_PREFIX,
        };
      },
      enabled: !!stateLvlTenantId,
    }
  );

  useEffect(() => {
    if (mdmsValidationData && mdmsValidationData?.UserProfileValidationConfig?.[0]) {
      const updatedValidationConfig = mapConfigToRegExp(mdmsValidationData);
      if (mdmsValidationData?.prefix) {
        updatedValidationConfig.prefix = mdmsValidationData.prefix;
      }
      setValidationConfig((prev) => ({ ...prev, ...updatedValidationConfig }));
    }
  }, [mdmsValidationData]);

  const getUserInfo = async () => {
    const uuid = userInfo?.uuid;
    const individualServicePath = window?.globalConfigs?.getConfig("INDIVIDUAL_SERVICE_CONTEXT_PATH");

    // The user-service /_search filters strictly on the tenantId field
    // in the body — i.e. it returns only users whose own tenantId
    // matches. `Digit.ULBService.getCurrentTenantId()` returns the
    // *city* tenant the citizen is currently navigating (e.g.
    // "ke.nairobi"), which is not necessarily the tenant the user
    // record itself lives in. Naipepea provisions citizen accounts at
    // the state tenant ("ke"), so searching at "ke.nairobi" came back
    // with zero results, userDetails stayed null, and gender + photo
    // never populated — making the Edit Profile form look like the
    // saved values had been lost (CCRS#556 follow-up). Use the user's
    // own tenantId from the session (falling back to the city tenant
    // for tenants that *do* provision at city level).
    const searchTenant = userInfo?.tenantId || tenant;

    if (uuid) {
      if (individualServicePath) {
        // New API using health-individual
        const response = await Digit.CustomService.getResponse({
          url: `${individualServicePath}/v1/_search`,
          useCache: false,
          method: "POST",
          userService: true,
          params: {
            limit: 1000,
            offset: 0,
            tenantId: searchTenant,
          },
          body: {
            Individual: {
              userUuid: [uuid],
              tenantId: searchTenant,
            },
          },
        });

        if (response?.Individual?.length) {
          setUserDetails(response.Individual[0]);
        }
      } else {
        // Old API
        const usersResponse = await Digit.UserService.userSearch(searchTenant, { uuid: [uuid] }, {});
        if (usersResponse?.user?.length) {
          setUserDetails(usersResponse.user[0]);
        }
      }
    }
  };

  React.useEffect(() => {
    window.addEventListener("resize", () => setWindowWidth(window.innerWidth));
    return () => {
      window.removeEventListener("resize", () => setWindowWidth(window.innerWidth));
    };
  });

  useEffect(() => {
    setLoading(true);

    getUserInfo();

    setGender({
      i18nKey: undefined,
      code: userDetails?.gender,
      value: userDetails?.gender,
    });

    // user.photo is stored in two different shapes depending on the
    // upload pipeline:
    //   - new uploads via /user/profile/_update persist a bare
    //     fileStoreId (e.g. "07505a88-cae6-4575-b808-…"),
    //   - legacy paths store a comma-separated list of pre-resolved
    //     URLs ("https://…/full,https://…/medium,https://…/small").
    // The pre-existing code only handled the second shape, so any
    // fresh upload showed nothing on refresh (CCRS#556 follow-up:
    // "profile image is uploaded but not reflected in UI"). Detect
    // the bare-id case and resolve via Filefetch.
    const photoValue = userDetails?.photo;
    if (!photoValue) {
      setProfileImg(null);
    } else if (photoValue.startsWith("http") || photoValue.includes(",")) {
      const thumbs = photoValue.split(",");
      setProfileImg(thumbs?.at(0));
    } else {
      (async () => {
        try {
          const res = await Digit.UploadServices.Filefetch([photoValue], stateId);
          const entry = res?.data?.fileStoreIds?.[0];
          if (entry?.url) {
            const urls = entry.url.split(",");
            const thumb = urls.find((u) => /small/i.test(u)) || urls[0];
            setProfileImg(thumb);
          }
        } catch (e) {
          // Avatar falls back to the placeholder glyph on failure —
          // intentionally silent so a stale id doesn't break the page.
        }
      })();
    }

    setLoading(false);
  }, [userDetails !== null]);

  let validation = {};
  const editScreen = false; // To-do: Deubug and make me dynamic or remove if not needed
  const onClickAddPic = () => setOpenUploadSide(!openUploadSlide);
  const TogleforPassword = () => setChangepassword(!changepassword);
  const setGenderName = (value) => setGender(value);
  const closeFileUploadDrawer = () => setOpenUploadSide(false);

  const setUserName = (value) => {
    setName(value);

    if (!validationConfig?.name?.test(value) || value.length === 0 || value.length > 50) {
      setErrors({
        ...errors,
        userName: {
          type: "pattern",
          message: "CORE_COMMON_PROFILE_NAME_INVALID",
        },
      });
    } else {
      setErrors({ ...errors, userName: null });
    }
  };

  const setUserEmailAddress = (value) => {
    if (userInfo?.userName !== value) {
      setEmail(value);

      if (value.length && !(value.includes("@") && value.includes("."))) {
        setErrors({
          ...errors,
          emailAddress: {
            type: "pattern",
            message: "CORE_COMMON_PROFILE_EMAIL_INVALID",
          },
        });
      } else {
        setErrors({ ...errors, emailAddress: null });
      }
    } else {
      setErrors({ ...errors, emailAddress: null });
    }
  };

  const setUserMobileNumber = (value) => {
    setMobileNo(value);

    if (userType === "employee" && !validationConfig?.mobileNumber?.test(value)) {
      setErrors({
        ...errors,
        mobileNumber: {
          type: "pattern",
          message: "CORE_COMMON_PROFILE_MOBILE_NUMBER_INVALID",
        },
      });
    } else {
      setErrors({ ...errors, mobileNumber: null });
    }
  };

  const setUserCurrentPassword = (value) => {
    // The state setter was previously missing — only the validity
    // check ran, so the typed value never made it into the
    // `currentPassword` state. That left the save handler's gate
    // `currentPassword.length && newPassword.length && confirmPassword.length`
    // permanently false, the change-password branch never fired, and
    // the API call was never made — silently breaking the entire
    // "Update password" flow for both citizens and employees. The
    // v2-styled employee form makes the bug visually obvious because
    // the controlled V2Input refuses keystrokes; the legacy TextInput
    // hid it because it wasn't bound to state. Mirror the sibling
    // handlers (`setUserNewPassword`, `setUserConfirmPassword`).
    setCurrentPassword(value);
    if (!validationConfig?.password.test(value)) {
      setErrors({
        ...errors,
        currentPassword: {
          type: "pattern",
          message: "CORE_COMMON_PROFILE_PASSWORD_INVALID",
        },
      });
    } else {
      setErrors({ ...errors, currentPassword: null });
    }
  };

  const setUserNewPassword = (value) => {
    setNewPassword(value);
    if (!validationConfig?.password.test(value)) {
      setErrors({
        ...errors,
        newPassword: {
          type: "pattern",
          message: "CORE_COMMON_PROFILE_PASSWORD_INVALID",
        },
      });
    } else {
      setErrors({ ...errors, newPassword: null });
    }
  };

  const setUserConfirmPassword = (value) => {
    setConfirmPassword(value);

    if (!validationConfig?.password.test(value)) {
      setErrors({
        ...errors,
        confirmPassword: {
          type: "pattern",
          message: "CORE_COMMON_PROFILE_PASSWORD_INVALID",
        },
      });
    } else {
      setErrors({ ...errors, confirmPassword: null });
    }
  };

  const removeProfilePic = () => {
    setProfilePic(null);
    setProfileImg(null);
  };

  const showToast = (type, message, duration = 5000) => {
    setToast({ key: type, action: message });
    setTimeout(() => {
      setToast(null);
    }, duration);
  };

  const updateProfile = async () => {
    setLoading(true);
    try {
      if (name) {
        setName((prev) => prev.trim());
      }

      if (!validationConfig?.name.test(name) || name === "" || name.length > 50 || name.length < 1) {
        throw JSON.stringify({
          type: "error",
          message: t("CORE_COMMON_PROFILE_NAME_INVALID"),
        });
      }

      if (userType === "employee" && !validationConfig?.mobileNumber.test(mobileNumber)) {
        throw JSON.stringify({
          type: "error",
          message: t("CORE_COMMON_PROFILE_MOBILE_NUMBER_INVALID"),
        });
      }

      if (email.length && !(email.includes("@") && email.includes("."))) {
        throw JSON.stringify({
          type: "error",
          message: t("CORE_COMMON_PROFILE_EMAIL_INVALID"),
        });
      }

      const trimmedCurrentPassword = currentPassword.trim();
      const trimmedNewPassword = newPassword.trim();
      const trimmedConfirmPassword = confirmPassword.trim();

      setCurrentPassword(trimmedCurrentPassword);
      setNewPassword(trimmedNewPassword);
      setConfirmPassword(trimmedConfirmPassword);

      if (changepassword && (trimmedCurrentPassword && trimmedNewPassword && trimmedConfirmPassword)) {
        if (trimmedNewPassword !== trimmedConfirmPassword) {
          throw JSON.stringify({
            type: "error",
            message: t("CORE_COMMON_PROFILE_PASSWORD_MISMATCH"),
          });
        }

        if (!(trimmedCurrentPassword.length && trimmedNewPassword.length && trimmedConfirmPassword.length)) {
          throw JSON.stringify({
            type: "error",
            message: t("CORE_COMMON_PROFILE_PASSWORD_INVALID"),
          });
        }

        if (!validationConfig?.password.test(trimmedNewPassword) && !validationConfig?.password.test(trimmedConfirmPassword)) {
          throw JSON.stringify({
            type: "error",
            message: t("CORE_COMMON_PROFILE_PASSWORD_INVALID"),
          });
        }
      }

      let responseInfo;
      const individualServicePath = window?.globalConfigs?.getConfig("INDIVIDUAL_SERVICE_CONTEXT_PATH");

      if (individualServicePath) {
        // Build Individual object dynamically
        const individualPayload = {
          ...userDetails,
          tenantId: tenant,
          name: {
            givenName: name.trim(),
            familyName: userDetails?.name?.familyName,
            otherNames: userDetails?.name?.otherNames,
          },
          mobileNumber: mobileNumber,
          isDeleted: false,
          isSystemUser: true,
          isSystemUserActive: true,
        };

        // Only add optional fields if they have values
        if (gender?.value) {
          individualPayload.gender = gender.value;
        }

        if (email) {
          individualPayload.email = email;
        }

        if (profilePic) {
          individualPayload.photo = profilePic;
        }

        const response = await Digit.CustomService.getResponse({
          url: `${individualServicePath}/v1/_update`,
          useCache: false,
          method: "POST",
          userService: true,
          body: {
            Individual: individualPayload,
          },
        });
        responseInfo = response?.responseInfo;
      }
      else {
        // Old API
        // `mobileNumber` was previously omitted from the override
        // list, so spreading `...userInfo` won and the save persisted
        // the stale session mobile no matter what the operator typed
        // into the form. The Individual branch above already passes
        // the form-state mobile; mirror that here.
        const requestData = {
          ...userInfo,
          name,
          gender: gender?.value,
          emailId: email,
          mobileNumber,
          photo: profilePic,
        };
        const response = await Digit.UserService.updateUser(requestData, stateCode);
        responseInfo = response?.responseInfo;
      }


      if (responseInfo && responseInfo.status === "200") {
        const user = Digit.UserService.getUser();

        if (user) {
          Digit.UserService.setUser({
            ...user,
            info: {
              ...user.info,
              name,
              mobileNumber,
              emailId: email,
              permanentCity: city,
            },
          });
        }
      }

      if (currentPassword.length && newPassword.length && confirmPassword.length) {
        // `type` was previously hardcoded to "EMPLOYEE" — the user
        // service uses this field to scope the username lookup, so a
        // citizen hitting Update Password got a `UserNotFoundException`
        // because no EMPLOYEE record matched their mobile-as-username.
        // Derive from the `userType` prop the route passes in
        // (`"citizen"` from /citizen/user/profile, `"employee"` from
        // /employee/user/profile) so the lookup runs against the
        // correct user table on both sides.
        const requestData = {
          existingPassword: currentPassword,
          newPassword: newPassword,
          tenantId: tenant,
          type: userType === "employee" ? "EMPLOYEE" : "CITIZEN",
          username: userInfo?.userName,
          confirmPassword: confirmPassword,
        };

        if (newPassword === confirmPassword) {
          try {
            const res = await Digit.UserService.changePassword(requestData, tenant);

            const { responseInfo: changePasswordResponseInfo } = res;
            if (changePasswordResponseInfo?.status && changePasswordResponseInfo.status === "200") {
              showToast("success", t("CORE_COMMON_PROFILE_UPDATE_SUCCESS_WITH_PASSWORD"), 5000);
              setTimeout(() => Digit.UserService.logout(), 2000);
            } else {
              throw "";
            }
          } catch (error) {
            throw JSON.stringify({
              type: "error",
              message: error.Errors?.at(0)?.description ? error.Errors.at(0).description : "CORE_COMMON_PROFILE_UPDATE_ERROR_WITH_PASSWORD",
            });
          }
        } else {
          throw JSON.stringify({
            type: "error",
            message: "CORE_COMMON_PROFILE_ERROR_PASSWORD_NOT_MATCH",
          });
        }
      } else if (responseInfo?.status && responseInfo.status === "200") {
        if ((userType === "citizen" || Digit.Utils.getMultiRootTenant()) && enableUserPreferences) {
          await saveUserPreferences();
        }
        showToast("success", t("CORE_COMMON_PROFILE_UPDATE_SUCCESS"), 5000);
      }
    } catch (error) {
      let errorObj;
      try {
        errorObj = JSON.parse(error);
      } catch (e) {
        errorObj = {
          type: "error",
          message: error?.response?.data?.Errors?.[0]?.description || "CORE_COMMON_PROFILE_UPDATE_ERROR",
        };
      }
      showToast(errorObj.type, t(errorObj.message), 5000);
    }

    setLoading(false);
  };

  let menu = [];
  const { data: Menu } = Digit.Hooks.useGenderMDMS(stateId, "common-masters", "GenderType");
  // Gender option labels resolve through react-i18next. The legacy
  // prefix `PT_COMMON_GENDER_*` was a property-tax-era artifact and is
  // not present in any locale module we ship — `t("PT_COMMON_GENDER_MALE")`
  // therefore echoed the raw key, so the dropdown showed
  // "PT_COMMON_GENDER_MALE" instead of "Male" (and looked like the
  // saved gender hadn't taken). The localisation tables do carry
  // `CORE_COMMON_GENDER_*` ("Male" / "Female" / "Transgender") in
  // rainmaker-common, so switch to that prefix and the dropdown
  // renders readable labels (CCRS#556 follow-up).
  Menu &&
    Menu.map((genderDetails) => {
      menu.push({
        i18nKey: `CORE_COMMON_GENDER_${genderDetails.code}`,
        code: `${genderDetails.code}`,
        value: `${genderDetails.code}`,
      });
    });

  const setFileStoreId = async (fileStoreId) => {
    setProfilePic(fileStoreId);

    const thumbnails = fileStoreId ? await getThumbnails([fileStoreId], stateId) : null;

    setProfileImg(thumbnails?.thumbs[0]);

    closeFileUploadDrawer();
  };

  const getThumbnails = async (ids, tenantId) => {
    const res = await Digit.UploadServices.Filefetch(ids, tenantId);
    if (res.data.fileStoreIds && res.data.fileStoreIds.length !== 0) {
      return {
        thumbs: res.data.fileStoreIds.map((o) => o.url.split(",")[3]),
        images: res.data.fileStoreIds.map((o) => Digit.Utils.getFileUrl(o.url)),
      };
    } else {
      return null;
    }
  };

  if (loading || isValidationConfigLoading) return <Loader></Loader>;

  // ----------------------------------------------------------------------
  // v2 Citizen branch — modernized chrome (form sections in a Card,
  // inline sticky save bar, theme-aware tokens). Employee path below
  // is unchanged.
  // ----------------------------------------------------------------------
  if (userType === "citizen") {
    const tr = (key, fallback) => {
      const v = t(key);
      return v === key ? fallback : v;
    };
    const genderOptions = (menu || []).map((g) => ({
      value: g.code,
      label: t(g.i18nKey),
    }));
    const languageOptions = (availableLanguages || []).map((l) => ({
      value: l.value,
      label: l.label,
    }));
    // The mobile-edit affordance is only honest when the save path actually
    // accepts the new number. The Individual-service write
    // (`/individual/v1/_update`) does; the legacy egov-user write
    // (`/user/profile/_update`) silently strips `mobileNumber` server-side
    // via `User.nullifySensitiveFields()` because the mobile is the login
    // handle and self-service rotation has no OTP-verify guard. On
    // deployments without the Individual service wired (e.g. naipepea), the
    // editable input is therefore a lie — render it read-only so we don't
    // promise behavior the backend prohibits. CCRS#555 follow-up.
    const canEditMobile = !!window?.globalConfigs?.getConfig("INDIVIDUAL_SERVICE_CONTEXT_PATH");
    return (
      <div
        className="v2-scope"
        style={{
          display: "flex",
          flexDirection: "column",
          // Pin the column to the available space between topbar and page
          // footer. Without an explicit height the inner overflow-y:auto
          // can't contain — when the form is taller than the viewport, the
          // BODY scrolls and the page footer drifts off-screen instead of
          // the form scrolling within its own column.
          height:
            "calc(100vh - var(--v2-topbar-height, 82px) - var(--v2-page-footer-height, 38px))",
          minHeight: 0,
          width: "100%",
        }}
      >
        <header
          style={{
            padding: "1rem 1.5rem 0.5rem 1.5rem",
            flexShrink: 0,
          }}
        >
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              margin: 0,
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              lineHeight: 1.25,
            }}
          >
            {tr("CORE_COMMON_PROFILE", "Edit Profile")}
          </h1>
        </header>
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "0.5rem 1.5rem 1.5rem 1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <V2Card
            style={{
              padding: "24px",
              display: "flex",
              alignItems: "center",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                position: "relative",
                height: "96px",
                width: "96px",
                flexShrink: 0,
              }}
            >
              {/* Inner circle hosts the photo / fallback. Overflow:hidden
                  clips the photo to a circle. The camera button sits in
                  the OUTER wrapper (no overflow:hidden) so it can extrude
                  past the circle's edge without getting clipped — same
                  affordance pattern as the sidebar's Avatar when extended
                  with an upload action. */}
              <div
                style={{
                  height: "100%",
                  width: "100%",
                  borderRadius: "9999px",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "var(--color-grey-mid, #eeeeee)",
                  color: "var(--color-text-secondary, #505a5f)",
                }}
              >
                {profileImg ? (
                  <ImageComponent
                    style={{ height: "100%", width: "100%", objectFit: "cover" }}
                    src={profileImg}
                    alt="Profile"
                  />
                ) : (name || userInfo?.name) ? (
                  <span style={{ fontSize: "2rem", fontWeight: 600 }}>
                    {(name || userInfo?.name || "").trim().charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 80 80"
                    fill="currentColor"
                    style={{ height: "60%", width: "60%", opacity: 0.4 }}
                    aria-hidden
                  >
                    <circle cx="40" cy="32" r="14" />
                    <path d="M12 70c0-15 13-24 28-24s28 9 28 24" />
                  </svg>
                )}
              </div>
              <button
                type="button"
                onClick={onClickAddPic}
                aria-label={tr("CORE_COMMON_CHANGE_PHOTO", "Change photo")}
                className="v2-profile-camera-btn"
                style={{
                  position: "absolute",
                  right: "0",
                  bottom: "0",
                  height: "32px",
                  width: "32px",
                  borderRadius: "9999px",
                  border: "2px solid #fff",
                  backgroundColor:
                    "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))",
                  color: "var(--color-text-primary, #0B0C0C)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(16, 24, 40, 0.12)",
                  padding: 0,
                  zIndex: 1,
                }}
              >
                <Camera style={{ height: "16px", width: "16px" }} />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "1.125rem",
                  fontWeight: 600,
                  color: "var(--color-text-heading, #363636)",
                }}
              >
                {name || userInfo?.name || tr("CORE_COMMON_PROFILE_NAME", "Your name")}
              </div>
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary, #6B7280)",
                  marginTop: "4px",
                }}
              >
                {mobileNumber || ""}
                {mobileNumber && email ? "  ·  " : ""}
                {email || ""}
              </div>
            </div>
          </V2Card>

          <V2Card
            style={{
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                color:
                  "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              }}
            >
              {tr("CORE_COMMON_PROFILE_PERSONAL_DETAILS", "Personal details")}
            </h2>
            <V2Field
              label={t("CORE_COMMON_PROFILE_NAME")}
              required
              htmlFor="profile-name"
              error={errors?.userName ? t(errors.userName.message) : undefined}
            >
              <V2Input
                id="profile-name"
                value={name}
                onChange={(e) => setUserName(e.target.value)}
                invalid={!!errors?.userName}
              />
            </V2Field>
            {genderOptions.length > 0 ? (
              <V2Field label={t("CORE_COMMON_PROFILE_GENDER")} htmlFor="profile-gender">
                <V2Select
                  id="profile-gender"
                  value={gender?.code ?? gender?.value}
                  onValueChange={(v) => {
                    const picked = menu.find((g) => g.code === v);
                    setGenderName(picked || { code: v, value: v });
                  }}
                  options={genderOptions}
                  placeholder={tr("CORE_COMMON_SELECT_GENDER", "Select gender")}
                />
              </V2Field>
            ) : null}
            <V2Field label={t("CORE_COMMON_PROFILE_EMAIL")} htmlFor="profile-email"
              error={errors?.emailAddress ? t(errors.emailAddress.message) : undefined}
            >
              <V2Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setUserEmailAddress(e.target.value)}
                invalid={!!errors?.emailAddress}
              />
            </V2Field>
            {enableUserPreferences && languageOptions.length > 0 ? (
              <V2Field
                label={t("CORE_COMMON_PREFERRED_LANGUAGE")}
                htmlFor="profile-language"
              >
                <V2Select
                  id="profile-language"
                  value={preferredLanguage}
                  onValueChange={(v) => setPreferredLanguage(v)}
                  options={languageOptions}
                  placeholder={tr("CORE_COMMON_SELECT_LANGUAGE", "Select language")}
                />
              </V2Field>
            ) : null}
          </V2Card>

          {enableUserPreferences ? (
            <V2Card
              style={{
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                  color:
                    "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                }}
              >
                {tr("CORE_COMMON_NOTIFICATION_PREFERENCES", "Notifications")}
              </h2>
              {[
                { key: "SMS", label: t("CORE_COMMON_SMS_NOTIFICATIONS") },
                { key: "EMAIL", label: t("CORE_COMMON_EMAIL_NOTIFICATIONS") },
                { key: "WHATSAPP", label: t("CORE_COMMON_WHATSAPP_NOTIFICATIONS") },
              ].map((channel) => {
                const isChannelEnabled = channelConfigData?.[channel.key] === true;
                const isOn = notificationConsent[channel.key].status === "GRANTED";
                return (
                  <div
                    key={channel.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--color-border, #e5e7eb)",
                      opacity: isChannelEnabled ? 1 : 0.55,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          color: "var(--color-text-heading, #363636)",
                        }}
                      >
                        {channel.label}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--color-text-secondary, #6B7280)",
                          marginTop: "2px",
                        }}
                      >
                        {isChannelEnabled
                          ? isOn
                            ? t("CORE_COMMON_ENABLED")
                            : t("CORE_COMMON_DISABLED")
                          : t("CORE_COMMON_DISABLED")}
                      </div>
                    </div>
                    <ToggleSwitch
                      value={isOn}
                      onChange={() =>
                        isChannelEnabled && handleConsentToggle(channel.key)
                      }
                      disabled={!isChannelEnabled}
                      name={`notification-${channel.key}`}
                      style={{ margin: 0 }}
                    />
                  </div>
                );
              })}
            </V2Card>
          ) : null}
        </div>
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--color-border, #e5e7eb)",
            padding: "12px 1.5rem",
            display: "flex",
            // Match the v2 file-complaint footer — Cancel on the left,
            // primary action on the right — so every modernized surface
            // shares the same action-bar geometry.
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <V2Button
            variant="outline"
            onClick={() => history.goBack()}
            type="button"
          >
            {tr("CORE_COMMON_CANCEL", "Cancel")}
          </V2Button>
          <V2Button
            onClick={updateProfile}
            type="button"
            leading={<Save className="h-4 w-4" />}
          >
            {tr("CORE_COMMON_SAVE", "Save")}
          </V2Button>
        </div>
        {toast && (
          <Toast
            type={toast.key}
            label={t(toast.key === "success" ? `CORE_COMMON_PROFILE_UPDATE_SUCCESS` : toast.action)}
            onClose={() => setToast(null)}
            style={{ maxWidth: "670px" }}
          />
        )}
        {openUploadSlide ? (
          <UploadDrawer
            setProfilePic={setFileStoreId}
            closeDrawer={closeFileUploadDrawer}
            userType={userType}
            removeProfilePic={removeProfilePic}
            showToast={showToast}
          />
        ) : null}
      </div>
    );
  }

  // v2 employee Edit Profile — modernized to match the citizen v2
  // surface: brand-tinted header, avatar Card, Personal Details Card,
  // a collapsible Change-Password Card, and a sticky footer with
  // Cancel / Save actions. The legacy render used `LabelFieldPair` +
  // `CardLabel` + the old `TextInput` / `MobileNumber` / `Dropdown`
  // widgets with hardcoded `#c84c0e` Save buttons and a free-flow
  // BreadCrumb — visually disjoint from the rest of the modernized
  // chrome (PGR inbox, citizen edit profile, file-complaint flow).
  // All field handlers (`setUserName`, `setGenderName`, etc.) and the
  // `updateProfile` save pipeline are unchanged; only the JSX swaps.
  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  const genderOptions = (menu || []).map((g) => ({
    value: g.code,
    label: t(g.i18nKey),
  }));
  const mobilePrefix =
    mdmsValidationData?.prefix ||
    window?.globalConfigs?.getConfig?.("CORE_MOBILE_CONFIGS")?.mobilePrefix ||
    DEFAULT_MOBILE_PREFIX;
  const isMultiRoot = Digit.Utils.getMultiRootTenant();

  // The employee chrome renders the digit-sidebar as `position: fixed`
  // at z-index 999, so the form's leftmost ~48px sit behind the
  // sidebar. Clear it via `padding-left` keyed off a CSS variable
  // (`--digit-sidebar-width`) with a 48px collapsed-rail fallback.
  // The form intentionally has *no* internal scroll — the page
  // scrolls when content overflows, and Cancel/Save just sit at the
  // natural end of the form rather than being pinned to the viewport
  // bottom.
  return (
    <div
      className="v2-scope"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        // Clear the fixed topbar so the h1 doesn't slide under it.
        paddingTop: "calc(var(--v2-topbar-height, 82px) + 0.5rem)",
        paddingLeft: "calc(var(--digit-sidebar-width, 48px) + 1rem)",
        paddingRight: "1.5rem",
        paddingBottom: "1.5rem",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%" }}>
      <header
        style={{
          padding: "1rem 0 0.5rem 0",
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            lineHeight: 1.25,
          }}
        >
          {tr("CORE_COMMON_PROFILE", "Edit Profile")}
        </h1>
      </header>

      <div
        style={{
          padding: "0.5rem 0 0 0",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Avatar identity card — circular photo with extruded camera
            button. Same construction as the citizen v2 surface so both
            sides share the affordance. */}
        <V2Card
          style={{
            padding: "24px",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              position: "relative",
              height: "96px",
              width: "96px",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                height: "100%",
                width: "100%",
                borderRadius: "9999px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--color-grey-mid, #eeeeee)",
                color: "var(--color-text-secondary, #505a5f)",
              }}
            >
              {profileImg ? (
                <ImageComponent
                  style={{ height: "100%", width: "100%", objectFit: "cover" }}
                  src={profileImg}
                  alt="Profile"
                />
              ) : (name || userInfo?.name) ? (
                <span style={{ fontSize: "2rem", fontWeight: 600 }}>
                  {(name || userInfo?.name || "").trim().charAt(0).toUpperCase()}
                </span>
              ) : (
                <svg
                  viewBox="0 0 80 80"
                  fill="currentColor"
                  style={{ height: "60%", width: "60%", opacity: 0.4 }}
                  aria-hidden
                >
                  <circle cx="40" cy="32" r="14" />
                  <path d="M12 70c0-15 13-24 28-24s28 9 28 24" />
                </svg>
              )}
            </div>
            <button
              type="button"
              onClick={onClickAddPic}
              aria-label={tr("CORE_COMMON_CHANGE_PHOTO", "Change photo")}
              className="v2-profile-camera-btn"
              style={{
                position: "absolute",
                right: "0",
                bottom: "0",
                height: "32px",
                width: "32px",
                borderRadius: "9999px",
                border: "2px solid #fff",
                backgroundColor:
                  "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))",
                color: "var(--color-text-primary, #0B0C0C)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(16, 24, 40, 0.12)",
                padding: 0,
                zIndex: 1,
              }}
            >
              <Camera style={{ height: "16px", width: "16px" }} />
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                color: "var(--color-text-heading, #363636)",
              }}
            >
              {name || userInfo?.name || tr("CORE_COMMON_PROFILE_NAME", "Your name")}
            </div>
            <div
              style={{
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary, #6B7280)",
                marginTop: "4px",
                wordBreak: "break-word",
              }}
            >
              {userInfo?.userName ? userInfo.userName : ""}
              {userInfo?.userName && (mobileNumber || email) ? "  ·  " : ""}
              {mobileNumber ? `${mobilePrefix} ${mobileNumber}` : ""}
              {mobileNumber && email ? "  ·  " : ""}
              {email || ""}
            </div>
          </div>
        </V2Card>

        {/* Personal details card */}
        <V2Card
          style={{
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "1rem",
              fontWeight: 600,
              color:
                "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            }}
          >
            {tr("CORE_COMMON_PROFILE_PERSONAL_DETAILS", "Personal details")}
          </h2>

          <V2Field
            label={t("CORE_COMMON_PROFILE_NAME")}
            required
            htmlFor="profile-name"
            error={errors?.userName ? t(errors.userName.message) : undefined}
          >
            <V2Input
              id="profile-name"
              value={name}
              onChange={(e) => setUserName(e.target.value)}
              invalid={!!errors?.userName}
              placeholder={tr("CORE_COMMON_PROFILE_NAME", "Enter your name")}
            />
          </V2Field>

          <V2Field
            label={t("CORE_COMMON_PROFILE_MOBILE_NUMBER")}
            required={canEditMobile}
            htmlFor="profile-mobile"
            error={errors?.mobileNumber ? t(errors.mobileNumber.message) : undefined}
          >
            {/* Pill: yellow prefix chip + flush local-digits input.
                Mirrors the login screen's `SelectMobileNumber` so the
                prefix visually links back to the rest of the
                modernized chrome (same `--color-primary-selected-bg`
                tint sidebar rows / dropdown options use). */}
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                width: "100%",
                borderRadius: "0.375rem",
                border: errors?.mobileNumber
                  ? "1px solid var(--color-error, #d4351c)"
                  : "1px solid var(--color-border, #d6d5d4)",
                background:
                  "var(--v2-surface-color, var(--color-surface, #ffffff))",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "0 12px",
                  borderRight: "1px solid var(--color-border, #d6d5d4)",
                  backgroundColor:
                    "var(--color-primary-selected-bg, #FFF4D7)",
                  color:
                    "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <Phone style={{ height: "0.95rem", width: "0.95rem" }} aria-hidden />
                {mobilePrefix}
              </span>
              <input
                id="profile-mobile"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel-national"
                value={mobileNumber || ""}
                onChange={canEditMobile ? (e) => setUserMobileNumber(e.target.value) : undefined}
                readOnly={!canEditMobile}
                aria-invalid={!!errors?.mobileNumber}
                aria-readonly={!canEditMobile || undefined}
                title={canEditMobile ? undefined : tr(
                  "CORE_COMMON_PROFILE_MOBILE_READONLY_HELP",
                  "Mobile number is your login identifier and cannot be changed from this screen."
                )}
                style={{
                  flex: 1,
                  border: 0,
                  outline: "none",
                  padding: "0 12px",
                  fontSize: "0.875rem",
                  background: "transparent",
                  color: canEditMobile
                    ? "var(--color-text-primary, #0B0C0C)"
                    : "var(--color-text-secondary, #505a5f)",
                  cursor: canEditMobile ? "text" : "not-allowed",
                  height: "2.5rem",
                  minWidth: 0,
                }}
              />
            </div>
            {!canEditMobile && (
              <p
                style={{
                  marginTop: "0.375rem",
                  fontSize: "0.75rem",
                  color: "var(--color-text-secondary, #505a5f)",
                }}
              >
                {tr(
                  "CORE_COMMON_PROFILE_MOBILE_READONLY_HELP",
                  "Mobile number is your login identifier and cannot be changed from this screen."
                )}
              </p>
            )}
          </V2Field>

          {genderOptions.length > 0 ? (
            <V2Field label={t("CORE_COMMON_PROFILE_GENDER")} htmlFor="profile-gender">
              <V2Select
                id="profile-gender"
                value={gender?.code ?? gender?.value}
                onValueChange={(v) => {
                  const picked = menu.find((g) => g.code === v);
                  setGenderName(picked || { code: v, value: v });
                }}
                options={genderOptions}
                placeholder={tr("CORE_COMMON_SELECT_GENDER", "Select gender")}
              />
            </V2Field>
          ) : null}

          <V2Field
            label={t("CORE_COMMON_PROFILE_EMAIL")}
            htmlFor="profile-email"
            error={errors?.emailAddress ? t(errors.emailAddress.message) : undefined}
          >
            <V2Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setUserEmailAddress(e.target.value)}
              invalid={!!errors?.emailAddress}
              disabled={isMultiRoot ? true : editScreen}
              autoComplete="email"
            />
          </V2Field>

          <V2Field label={t("CORE_COMMON_PROFILE_CITY")} htmlFor="profile-city">
            <V2Input
              id="profile-city"
              value={t(Digit.Utils.locale.getTransformedLocale(`TENANT_TENANTS_${tenant}`))}
              disabled
            />
          </V2Field>
        </V2Card>

        {/* Password change card — only mounted when the deployment is
            not using OTP-based login, matching the legacy gate. */}
        {!Digit.Utils.getOTPBasedLogin() ? (
          <V2Card
            style={{
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                  color:
                    "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                }}
              >
                {tr("CORE_COMMON_CHANGE_PASSWORD", "Change password")}
              </h2>
              <V2Button
                variant={changepassword ? "outline" : "secondary"}
                onClick={TogleforPassword}
                type="button"
              >
                {changepassword
                  ? tr("CORE_COMMON_CANCEL", "Cancel")
                  : tr("CORE_COMMON_CHANGE_PASSWORD", "Change password")}
              </V2Button>
            </div>

            {changepassword ? (
              <>
                <V2Field
                  label={tr("CORE_COMMON_PROFILE_CURRENT_PASSWORD", "Current password")}
                  htmlFor="profile-current-password"
                  error={errors?.currentPassword ? t(errors.currentPassword.message) : undefined}
                >
                  <V2Input
                    id="profile-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setUserCurrentPassword(e.target.value)}
                    invalid={!!errors?.currentPassword}
                    autoComplete="current-password"
                  />
                </V2Field>
                <V2Field
                  label={tr("CORE_COMMON_PROFILE_NEW_PASSWORD", "New password")}
                  htmlFor="profile-new-password"
                  error={errors?.newPassword ? t(errors.newPassword.message) : undefined}
                >
                  <V2Input
                    id="profile-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setUserNewPassword(e.target.value)}
                    invalid={!!errors?.newPassword}
                    autoComplete="new-password"
                  />
                </V2Field>
                <V2Field
                  label={tr("CORE_COMMON_PROFILE_CONFIRM_PASSWORD", "Confirm new password")}
                  htmlFor="profile-confirm-password"
                  error={errors?.confirmPassword ? t(errors.confirmPassword.message) : undefined}
                >
                  <V2Input
                    id="profile-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setUserConfirmPassword(e.target.value)}
                    invalid={!!errors?.confirmPassword}
                    autoComplete="new-password"
                  />
                </V2Field>
              </>
            ) : null}
          </V2Card>
        ) : null}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border, #e5e7eb)",
          marginTop: "16px",
          padding: "16px 0 0 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <V2Button
          variant="outline"
          onClick={() => history.goBack()}
          type="button"
        >
          {tr("CORE_COMMON_CANCEL", "Cancel")}
        </V2Button>
        <V2Button
          onClick={updateProfile}
          type="button"
          leading={<Save className="h-4 w-4" />}
          disabled={loading}
        >
          {tr("CORE_COMMON_SAVE", "Save")}
        </V2Button>
      </div>

      </div>

      {toast && (
        <Toast
          type={toast.key}
          label={t(toast.key === "success" ? `CORE_COMMON_PROFILE_UPDATE_SUCCESS` : toast.action)}
          onClose={() => setToast(null)}
          style={{ maxWidth: "670px" }}
        />
      )}

      {openUploadSlide ? (
        <UploadDrawer
          setProfilePic={setFileStoreId}
          closeDrawer={closeFileUploadDrawer}
          userType={userType}
          removeProfilePic={removeProfilePic}
          showToast={showToast}
        />
      ) : null}
    </div>
  );
};

export default UserProfile;