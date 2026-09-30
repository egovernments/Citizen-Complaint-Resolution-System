/**
 * Readers for MDMS RAINMAKER-PGR.UIConstants, the tenant's PGR UI knobs. The
 * UI reads the first record, as useReopenWindow does.
 */

/**
 * Whether File a Complaint offers voice input. It's on unless the tenant set
 * VOICE_INPUT to false, so a tenant without the key keeps the mic.
 */
export const voiceInputEnabled = (constants) => {
  const record = Array.isArray(constants) ? constants[0] : undefined;
  return record?.VOICE_INPUT !== false;
};
