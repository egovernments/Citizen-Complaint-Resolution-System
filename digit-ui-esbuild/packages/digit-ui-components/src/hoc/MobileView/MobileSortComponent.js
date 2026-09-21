import React, { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { InboxContext } from "../InboxSearchComposerContext";
import { CustomSVG } from "../../atoms";
import Footer from "../../atoms/Footer";
import SubmitBar from "../../atoms/SubmitBar";
import RadioButtons from "../../atoms/RadioButtons";
import Button from "../../atoms/Button";

/**
 * Sort picker for the mobile inbox.
 *
 * The desktop table sorts from its column headers, which don't exist below
 * 426px, so a phone had no way to reorder the list at all (#2038 mobile
 * review). The options are derived from the same `searchResult` columns the
 * desktop header uses: a column is sortable when it declares the `sortKey`
 * that maps to the service's SortBy value. That keeps the two surfaces
 * offering exactly the same orderings without a second place to configure.
 *
 * Writes sortBy / sortOrder into `tableForm`, which is the same reducer slot
 * ResultsDataTableWrapper's onSort writes on desktop, so the request shape
 * and the module's preProcess are unchanged.
 */
// RadioButtons runs its own t() over `optionsKey`, so there is no room to
// pass a default there. These keys are not seeded in localization yet, so
// resolve them here with an English fallback: a second t() over an already
// resolved string is a no-op when no key matches it.
const buildOrders = (t) => [
  { code: "ASC", name: t("CS_COMMON_SORT_ASC", "Ascending") },
  { code: "DESC", name: t("CS_COMMON_SORT_DESC", "Descending") },
];

export const getSortableColumns = (columns) =>
  (columns || [])
    .filter((column) => column?.sortKey && !column?.disableSortBy)
    .map((column) => ({ code: column.sortKey, name: column.label }));

const MobileSortComponent = ({ uiConfig, fullConfig, onClose }) => {
  const { t } = useTranslation();
  const { state, dispatch } = useContext(InboxContext);

  const resultsConfig = fullConfig?.sections?.searchResult?.uiConfig;
  const options = getSortableColumns(resultsConfig?.columns);
  const ORDERS = React.useMemo(() => buildOrders(t), [t]);

  // Seed from what is applied, falling back to the config's own default so
  // the picker opens on the order the list is actually in.
  const [sortBy, setSortBy] = useState(
    () =>
      options.find((o) => o.code === (state?.tableForm?.sortBy ?? resultsConfig?.defaultSortBy)) ||
      options[0]
  );
  const [sortOrder, setSortOrder] = useState(
    () =>
      ORDERS.find(
        (o) => o.code === (state?.tableForm?.sortOrder ?? resultsConfig?.defaultSortOrder)
      ) || ORDERS[0]
  );

  const apply = () => {
    onClose?.();
    dispatch({
      type: "tableForm",
      // Back to the first page: the row you were looking at on page 3 is not
      // on page 3 any more once the order changes.
      state: { sortBy: sortBy?.code, sortOrder: sortOrder?.code, offset: 0 },
    });
  };

  // Same split as the Filter / Search modal: the header refresh icon resets
  // the picker in place, the footer button is terminal so it commits the
  // default order and closes. Without committing, "Clear All" would look
  // like it did nothing until you pressed Apply, which is the defect the
  // filter modal was reported for.
  const reset = ({ close = false } = {}) => {
    const defaultBy =
      options.find((o) => o.code === resultsConfig?.defaultSortBy) || options[0];
    const defaultOrder =
      ORDERS.find((o) => o.code === resultsConfig?.defaultSortOrder) || ORDERS[0];
    setSortBy(defaultBy);
    setSortOrder(defaultOrder);
    if (close) {
      onClose?.();
      dispatch({
        type: "tableForm",
        state: { sortBy: defaultBy?.code, sortOrder: defaultOrder?.code, offset: 0 },
      });
    }
  };

  if (options.length === 0) return null;

  return (
    <div className="digit-search-wrapper">
      {/* No close control here: the wrapping PopUp draws one. */}
      <div className="popup-label" style={{ display: "flex", paddingBottom: "20px" }}>
        <span className="header" style={{ display: "flex" }}>
          <span className="icon" style={{ marginRight: "12px", marginTop: "5px", paddingBottom: "3px" }}>
            <CustomSVG.SortSvg />
          </span>
          <span style={{ fontSize: "1.5rem", fontWeight: "700", marginRight: "12px" }}>
            {t(uiConfig?.headerLabel || "CS_COMMON_SORT_BY", "Sort by")}
          </span>
          <span className="clear-search refresh-icon-container" onClick={() => reset()}>
            <CustomSVG.RefreshIcon />
          </span>
        </span>
      </div>

      <div className="digit-search-field-wrapper inbox sort vertical-gap">
        <div className="digit-label-field-pair">
          <span className="digit-header-content label">{t("CS_COMMON_SORT_BY", "Sort by")}</span>
          <RadioButtons
            options={options}
            optionsKey="name"
            selectedOption={sortBy}
            onSelect={setSortBy}
            name="mobile-sort-by"
            alignVertical={true}
          />
        </div>
        <div className="digit-label-field-pair">
          <span className="digit-header-content label">{t("CS_COMMON_SORT_ORDER", "Order")}</span>
          <RadioButtons
            options={ORDERS}
            optionsKey="name"
            selectedOption={sortOrder}
            onSelect={setSortOrder}
            name="mobile-sort-order"
            alignVertical={true}
          />
        </div>
        <Footer
          className="clear-search-container"
          actionFields={[
            <div className="digit-search-button-wrapper inbox sort">
              <Button
                label={t("ES_CLEAR_ALL")}
                variation="secondary"
                onClick={() => reset({ close: true })}
                type="button"
              />
              <SubmitBar label={t("ES_COMMON_APPLY")} onSubmit={apply} />
            </div>,
          ]}
        ></Footer>
      </div>
    </div>
  );
};

export default MobileSortComponent;
