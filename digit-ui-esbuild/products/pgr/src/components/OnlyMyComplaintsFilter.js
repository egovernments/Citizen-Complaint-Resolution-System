import React from "react";
import { CheckBox } from "@egovernments/digit-ui-components";

/**
 * Inbox filter: "only complaints I created".
 *
 * Rendered through the inbox filter panel's `type: "component"` slot — the same
 * mechanism PGRBoundaryComponent uses. A plain `type: "checkbox"` field does NOT
 * work here: RenderFormFields (digit-ui-components) has no `checkbox` case, so it
 * falls to `default:` and returns the raw `populators` object, which React then
 * tries to render as a child (error #31).
 *
 * Checked is the default and is expressed as "not explicitly false", so a form
 * state that has never been touched reads as checked and the inbox opens scoped
 * to the officer's own work exactly as it did before this control existed.
 * UICustomizations' inbox preProcess applies the same `!== false` test.
 */
const OnlyMyComplaintsFilter = ({ t, config, formData, onSelect }) => {
  const name = config?.key || "onlyMyComplaints";
  const checked = formData?.[name] !== false;

  return (
    <div className="pgr-only-mine-filter">
      <CheckBox
        label={t("ES_PGR_FILTER_ONLY_MY_COMPLAINTS")}
        checked={checked}
        value={checked}
        onChange={(e) => onSelect(name, e.target.checked)}
      />
    </div>
  );
};

export default OnlyMyComplaintsFilter;
