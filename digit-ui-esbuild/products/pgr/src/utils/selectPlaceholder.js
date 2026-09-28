/**
 * Translated "Select <field>" for the complaint pickers.
 *
 * The pickers built this as the English word "Select" followed by an already
 * translated label, so a Portuguese form read "Select Condado". The verb comes
 * from ES_CREATECOMPLAINT_SELECT_PLACEHOLDER, which every seeded locale already
 * carries (Sélectionner, Selecionar, Chagua); all of them put the verb first,
 * so joining the two reads naturally. English is the fallback when a tenant
 * has not seeded the key, which is what every locale showed before.
 */
export const translateOr = (t, key, fallback) => {
  const value = t(key);
  return value && value !== key ? value : fallback;
};

export const selectPlaceholder = (t, fieldLabel) =>
  `${translateOr(t, "ES_CREATECOMPLAINT_SELECT_PLACEHOLDER", "Select")} ${fieldLabel}`;
