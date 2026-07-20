import { BackButton, HeaderComponent, Loader ,SearchIconSvg} from "@egovernments/digit-ui-components";
import React, { Fragment } from "react";
import { useTranslation } from "react-i18next";
import FaqComponent from "./FaqComponent";

const FAQsSection = ({ module }) => {
  const user = Digit.UserService.getUser();
  const tenantId = user?.info?.tenantId || Digit.ULBService.getCurrentTenantId();
  const { t } = useTranslation();

  const SearchImg = () => {
    return <SearchIconSvg className="signature-img" />;
  };

  const { isLoading, data } = Digit.Hooks.useGetFAQsJSON(Digit.ULBService.getStateId());

  // Defensive read: the MDMS master may be unseeded, empty, or shaped
  // without this module's key. Any raw member access on a missing level
  // used to throw and bubble to the module error boundary (CCRS#12) — the
  // page rendered the error fallback even though "no FAQs" is a valid,
  // non-error state. Fall back to an empty list and render gracefully.
  const moduleFaqs = data?.MdmsRes?.["common-masters"]?.faqs?.[0]?.[`${module}`]?.faqs || [];

  if (isLoading) {
    return <Loader />;
  }
  return (
    <Fragment>
      <div className="faq-page">
        <BackButton style={{ marginLeft: "unset" }}></BackButton>
        <div style={{ marginBottom: "15px" }}>
          <HeaderComponent styles={{ marginLeft: "0px", paddingTop: "10px", fontSize: "32px" }}>{t("FAQ_S")}</HeaderComponent>
        </div>
        <div className="faq-list">
          {moduleFaqs.length === 0 ? (
            <div style={{ padding: "10px 0" }}>{t("CS_NO_FAQ_FOUND") === "CS_NO_FAQ_FOUND" ? "No FAQs available." : t("CS_NO_FAQ_FOUND")}</div>
          ) : (
            moduleFaqs.map((faq, i) => (
              <FaqComponent key={"faq_" + i} question={faq.question} answer={faq.answer} lastIndex={i === moduleFaqs?.length - 1} />
            ))
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default FAQsSection;
