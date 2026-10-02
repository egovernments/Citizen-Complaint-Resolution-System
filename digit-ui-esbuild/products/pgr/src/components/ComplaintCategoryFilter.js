import React, { useMemo } from "react";
import { Controller } from "react-hook-form";
import { Field as V2Field, Select as V2Select } from "@egovernments/digit-ui-components-v2";
import { complaintLabel } from "../utils/complaintLabel";
import { complaintCategories, subcategoryFits } from "../utils/complaintCategories";
import { selectPlaceholder, translateOr } from "../utils/selectPlaceholder";

/**
 * The inbox filter's Complaint Category and Complaint Subcategory.
 *
 * Both come from the tenant's complaint types, which the inbox injects as this
 * field's options (each a subcategory carrying its category as `menuPath`).
 * Picking a category narrows the subcategories to its own, and a subcategory
 * from another category is dropped; a subcategory picked first fills in its
 * category. The search sends the chosen subcategory, or with only a category,
 * every subcategory under it.
 *
 * The subcategory is this field's own value (`serviceCode`, as before); the
 * category is a second form value, `complaintType`, registered here so the
 * form keeps it and Clear All resets it.
 */
const ComplaintCategoryFilter = ({ t, config, control, props }) => {
  const defs = config?.populators?.options || [];
  const categories = useMemo(() => complaintCategories(defs, t), [defs, t]);
  const searchPlaceholder = translateOr(t, "CS_COMMON_SEARCH", "Search");
  const categoryLabel = translateOr(t, "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE", "Complaint Category");
  const subcategoryLabel = translateOr(t, "CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE", "Complaint Subcategory");
  const subcategory = props?.value;

  return (
    <Controller
      name="complaintType"
      control={control}
      render={({ value: category, onChange: setCategory }) => {
        const subcategories = defs
          .filter((def) => def?.serviceCode && (!category?.code || def.menuPath === category.code))
          .map((def) => ({ value: def.serviceCode, label: def.i18nKey || complaintLabel(t, def.serviceCode, def.name) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return (
          <div className="pgr-category-filter" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <V2Field label={categoryLabel} htmlFor="pgr-filter-category">
              <V2Select
                id="pgr-filter-category"
                value={category?.code}
                onValueChange={(code) => {
                  const picked = categories.find((option) => option.code === code) || null;
                  setCategory(picked);
                  // Checked against the category's own list: a subcategory
                  // with no parent has no menuPath to compare, and would
                  // otherwise stay and win the search over the category.
                  if (!subcategoryFits(subcategory, picked)) props.onChange(null);
                }}
                options={categories.map((option) => ({ value: option.code, label: option.label }))}
                searchable
                searchPlaceholder={searchPlaceholder}
                placeholder={selectPlaceholder(t, categoryLabel)}
              />
            </V2Field>
            <V2Field label={subcategoryLabel} htmlFor="pgr-filter-subcategory">
              <V2Select
                id="pgr-filter-subcategory"
                value={subcategory?.serviceCode}
                onValueChange={(code) => {
                  const picked = defs.find((def) => def.serviceCode === code) || null;
                  props.onChange(picked);
                  // A subcategory picked first brings its category with it,
                  // so the two never disagree.
                  const parent = picked?.menuPath && categories.find((option) => option.code === picked.menuPath);
                  if (parent && parent.code !== category?.code) setCategory(parent);
                }}
                options={subcategories}
                searchable
                searchPlaceholder={searchPlaceholder}
                placeholder={selectPlaceholder(t, subcategoryLabel)}
              />
            </V2Field>
          </div>
        );
      }}
    />
  );
};

export default ComplaintCategoryFilter;
