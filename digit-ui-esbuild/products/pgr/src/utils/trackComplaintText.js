// Success-page supporting text after a complaint is filed. It must not promise
// SMS/WhatsApp: those channels are per-tenant opt-in and digit-ui has no
// reliable signal for them, so the text stays channel-neutral (#2675).
// A NEW key (not CS_COMMON_TRACK_COMPLAINT_TEXT) because existing tenants'
// rainmaker-pgr rows still carry the old SMS wording.
export const TRACK_COMPLAINT_TEXT_KEY = "CS_COMMON_TRACK_COMPLAINT_NEUTRAL_TEXT";
export const TRACK_COMPLAINT_TEXT_FALLBACK = "Keep the complaint number to track the complaint on the web or mobile app.";

export const trackComplaintText = (t) => {
  const v = t(TRACK_COMPLAINT_TEXT_KEY);
  return v && v !== TRACK_COMPLAINT_TEXT_KEY ? v : TRACK_COMPLAINT_TEXT_FALLBACK;
};
