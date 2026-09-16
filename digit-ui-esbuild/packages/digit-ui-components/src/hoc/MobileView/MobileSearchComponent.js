import React, { useContext, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { InboxContext } from "../InboxSearchComposerContext";
import { CustomSVG } from "../../atoms";
import Footer from "../../atoms/Footer";
import SubmitBar from "../../atoms/SubmitBar";
import LinkLabel from "../../atoms/LinkLabel";
import RenderFormFields from "../../molecules/RenderFormFields";
import Toast from "../../atoms/Toast";
import _ from "lodash";
import Button from "../../atoms/Button";

const MobileSearchComponent = ({
  uiConfig,
  modalType,
  header = "",
  screenType = "search",
  fullConfig,
  data,
  onClose,
  defaultValues,
}) => {
  const { t } = useTranslation();
  const { state, dispatch } = useContext(InboxContext);
  const [showToast, setShowToast] = useState(null);
  const { apiDetails } = fullConfig;

  if (fullConfig?.postProcessResult) {
    //conditions can be added while calling postprocess function to pass different params
    Digit?.Customizations?.[apiDetails?.masterName]?.[
      apiDetails?.moduleName
    ]?.postProcess(data, uiConfig);
  }

  // The desktop Search/Filter form is rendered inline and never unmounts,
  // so whatever the operator applied stays on screen. This modal is mounted
  // by `{popup && <PopUp>}`, so it is torn down on every close and rebuilt
  // with fresh `useForm` defaults — the applied criteria were gone on
  // reopen (#2038 mobile review).
  //
  // It used to read them from a `browserSession` prop, but the composer
  // never passes one, so `session` was always undefined and the two
  // branches were inverted besides (the filter modal read `searchForm`).
  // The reducer state behind InboxContext is the authoritative record of
  // what is currently applied, and this component already consumes it, so
  // seed from there instead.
  const appliedCriteria =
    modalType === "SEARCH" ? state?.searchForm : state?.filterForm;

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    watch,
    control,
    formState,
    errors,
    setError,
    clearErrors,
  } = useForm({
    defaultValues: { ...uiConfig?.defaultValues, ...appliedCriteria },
  });
  const formData = watch();

  const checkKeyDown = (e) => {
    const keyCode = e.keyCode ? e.keyCode : e.key ? e.key : e.which;
    if (keyCode === 13) {
      e.preventDefault();
    }
  };

  // //on form value change, update session data with form data
  // useEffect(()=>{
  //   if (!_.isEqual(sessionFormData, formData)) {
  //     // const difference = _.pickBy(sessionFormData, (v, k) => !_.isEqual(formData[k], v));
  //     setSessionFormData({ ...sessionFormData,...formData,  });
  //   }
  // },[formData]);

  // useEffect(()=>{
  //   clearSessionFormData();
  // },[]);

  // Pagination has to go back to the first page whenever the criteria
  // change, otherwise a narrower result set is read at the old offset and
  // the list looks empty or unchanged. The desktop component does this on
  // both apply and clear; this one did it on neither, which is the
  // "not consistent with desktop view" half of the mobile report.
  //
  // Only `offset` is dispatched. The reducer merges into tableForm, so
  // `limit` and `sortOrder` survive — the desktop version rewrites both,
  // which would undo a config's `customDefaultPagination`. The companion
  // "tableFormUpdate" event desktop fires is deliberately not fired here:
  // its only listener is ResultsDataTableWrapper, which renders above
  // 426px, and this modal only exists below it.
  const resetPagination = () => {
    dispatch({ type: "tableForm", state: { offset: 0 } });
  };

  // `minReqFields` means "at least this many criteria supplied". Counting
  // `formState.dirtyFields` only answers "how many did you touch in this
  // sitting", which is not the same thing now that the form opens seeded
  // with what is already applied — reopening Search and pressing Search
  // again would otherwise be rejected as empty. Count what is actually
  // being submitted instead.
  const isSupplied = (v) => {
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    // Dropdowns submit {code, name} and date ranges submit
    // {startDate, endDate}; an untouched range is an object of empty
    // values, so look inside rather than counting any object as a value.
    if (typeof v === "object") return Object.values(v).some(isSupplied);
    return true;
  };

  const countCriteria = (data) => Object.values(data || {}).filter(isSupplied).length;

  const onSubmit = (data) => {
    if (countCriteria(data) < (uiConfig?.minReqFields || 0)) {
      setShowToast({
        warning: true,
        label: t("ES_COMMON_MIN_SEARCH_CRITERIA_MSG"),
      });
      setTimeout(closeToast, 3000);
      return;
    }
    onClose?.();
    // here based on screenType call respective dispatch fn
    dispatch({
      type: modalType === "SEARCH" ? "searchForm" : "filterForm",
      state: {
        ...data,
      },
    });
    resetPagination();
  };

  const clearSearch = () => {
    reset(uiConfig?.defaultValues);
    // Keyed off `modalType` like onSubmit above. `uiConfig.type` is not set
    // on every section (PGR's search section omits it), so the two handlers
    // could disagree about which form they were acting on.
    dispatch({
      type: modalType === "SEARCH" ? "clearSearchForm" : "clearFilterForm",
      state: { ...uiConfig?.defaultValues },
      //need to pass form with empty strings
    });
    resetPagination();
  };

  const closeToast = () => {
    setShowToast(null);
  };

  // The wrapping PopUp renders the close X and handles the overlay click,
  // so the header must not render a second one — mobile QA saw "the close
  // icon is displayed twice on top right corner" (#2038).
  //
  // Switches on `typeMobile` falling back to `type`: only a few configs set
  // `typeMobile` (PGR's filter section does not), and without the fallback
  // the filter modal picked the default branch and rendered the search
  // header, losing the filter icon and the reset control with it.
  const renderHeader = () => {
    const kind = uiConfig?.typeMobile || uiConfig?.type || "search";
    const isFilter = kind === "filter";
    const isSort = kind === "sort";
    const Icon = isFilter
      ? CustomSVG.FilterIcon
      : isSort
      ? CustomSVG.SortSvg
      : CustomSVG.SearchIcon;
    return (
      <div className="popup-label" style={{ display: "flex", paddingBottom: "20px" }}>
        <span className="header" style={{ display: "flex" }}>
          <span
            className="icon"
            style={{ marginRight: "12px", marginTop: "5px", paddingBottom: isFilter || isSort ? "3px" : undefined }}
          >
            <Icon />
          </span>
          <span
            style={
              isFilter || isSort
                ? { fontSize: "1.5rem", fontWeight: "700", marginRight: "12px" }
                : { fontSize: "large" }
            }
          >
            {t(`${uiConfig?.headerLabel || "ES_COMMON_SEARCH_BY"}`)}
          </span>
          {(isFilter || isSort) && (
            <span className="clear-search refresh-icon-container" onClick={clearSearch}>
              <CustomSVG.RefreshIcon />
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <React.Fragment>
      <div className="digit-search-wrapper">
        <div>{renderHeader()}</div>
        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => checkKeyDown(e)}
        >
          <div
            className={`digit-search-field-wrapper ${screenType} ${uiConfig?.typeMobile} vertical-gap`}
          >
            <RenderFormFields
              fields={uiConfig?.fields}
              control={control}
              formData={formData}
              errors={errors}
              register={register}
              setValue={setValue}
              getValues={getValues}
              setError={setError}
              clearErrors={clearErrors}
              labelStyle={{ fontSize: "16px" }}
              apiDetails={apiDetails}
              data={data}
            />
            <Footer
              className="clear-search-container"
              actionFields={[
                <div
                  className={`digit-search-button-wrapper ${screenType} inbox  ${uiConfig?.typeMobile}`}
                >
                  {/* { uiConfig?.secondaryLabel && <LinkLabel style={{marginBottom: 0, whiteSpace: 'nowrap'}} onClick={clearSearch}>{t(uiConfig?.secondaryLabel)}</LinkLabel> } */}
                  {uiConfig?.secondaryLabel && (
                    <Button
                      label={t(uiConfig?.secondaryLabel)}
                      variation="secondary"
                      onButtonClick={() => clearSearch()}
                      type="button"
                    />
                  )}
                  {uiConfig?.primaryLabel && (
                    <SubmitBar
                      label={t(uiConfig?.primaryLabel)}
                      submit="submit"
                      disabled={false}
                    />
                  )}
                </div>,
              ]}
            ></Footer>
          </div>
        </form>
        {showToast && (
          <Toast
            error={showToast.error}
            warning={showToast.warning}
            label={t(showToast.label)}
            isDleteBtn={true}
            onClose={closeToast}
          />
        )}
      </div>
    </React.Fragment>
  );
};

export default MobileSearchComponent;