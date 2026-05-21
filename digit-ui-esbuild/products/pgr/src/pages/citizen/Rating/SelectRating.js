import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { useParams, useHistory } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "react-query";
import { Star } from "lucide-react";
import {
  Card,
  Field,
  Textarea,
  Button,
  ScreenContainer,
  ScreenHeader,
} from "@egovernments/digit-ui-components-v2";

import { updateComplaints } from "../../../redux/actions/index";

// i18n fallback — when a translation key is unavailable, surface the
// English copy instead of leaving a raw constant on screen.
function tr(t, key, fallback) {
  const v = t(key);
  return v === key ? fallback : v;
}

const FEEDBACK_KEYS = [
  "CS_FEEDBACK_SERVICES",
  "CS_FEEDBACK_RESOLUTION_TIME",
  "CS_FEEDBACK_QUALITY_OF_WORK",
  "CS_FEEDBACK_OTHERS",
];

/**
 * Star-rating row — five buttons with a Lucide Star icon, brand-tinted
 * fill on selection. Hover preview gives visual feedback before commit.
 * Replaces the legacy <Rating /> from digit-ui-react-components which
 * shipped its own non-themed glyphs.
 */
function StarRow({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div
      role="radiogroup"
      aria-label="rating"
      style={{ display: "flex", gap: "8px" }}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const lit = i <= active;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i === 1 ? "" : "s"}`}
            onClick={() => onChange(i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(0)}
            className="v2-rating-star"
            style={{
              padding: 4,
              border: 0,
              background: "transparent",
              cursor: "pointer",
              lineHeight: 0,
            }}
          >
            <Star
              size={36}
              strokeWidth={1.5}
              style={{
                color: lit
                  ? "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))"
                  : "var(--color-border, #d6d5d4)",
                fill: lit
                  ? "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))"
                  : "transparent",
                transition: "color 120ms ease-out, fill 120ms ease-out",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Native checkbox styled to read with the v2 surface — brand-tinted
 * accent on check, theme border, matching the file-complaint form's
 * input rhythm so the rating page doesn't feel like a different app.
 */
function FeedbackCheckbox({ checked, onChange, label }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        userSelect: "none",
        fontSize: "0.875rem",
        color: "var(--color-text-primary, #0B0C0C)",
        transition: "background-color 120ms ease-out",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="v2-feedback-cb"
        style={{
          width: 18,
          height: 18,
          margin: 0,
          accentColor:
            "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
          cursor: "pointer",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </label>
  );
}

const SelectRating = ({ parentRoute }) => {
  const { t } = useTranslation();
  const { id } = useParams();
  const dispatch = useDispatch();
  const history = useHistory();
  const queryClient = useQueryClient();

  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const complaintDetails = Digit.Hooks.pgr.useComplaintDetails({
    tenantId,
    id,
  }).complaintDetails;
  const updateComplaint = useCallback(
    (payload) => dispatch(updateComplaints(payload)),
    [dispatch]
  );

  const [rating, setRating] = useState(0);
  const [picks, setPicks] = useState({});
  const [comments, setComments] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!(complaintDetails?.service && rating > 0)) {
      setSubmitError(true);
      return;
    }
    setSubmitError(false);
    setSubmitting(true);

    // CS_FEEDBACK_WHAT_WAS_GOOD historically shipped as undefined when
    // no boxes were ticked and `.join` blew up the page (CCRS#441).
    // Sticking to the same payload: csv of localised picks.
    const selections = FEEDBACK_KEYS.filter((k) => picks[k]).map((k) => t(k));

    complaintDetails.service.rating = rating;
    complaintDetails.service.additionalDetail = selections.join(",");
    complaintDetails.workflow = {
      action: "RATE",
      comments,
      verificationDocuments: [],
    };

    try {
      // Await — Response.js reads the redux slice on mount and a race
      // here used to leave it blank (CCRS#473).
      await updateComplaint({
        service: complaintDetails.service,
        workflow: complaintDetails.workflow,
      });
      // Invalidate the cached complaint-details + complaints-list
      // queries so when the citizen navigates back to /complaint-
      // details the page refetches with the freshly-saved rating.
      // Without this, react-query served the stale (rating === 0)
      // payload until manual page refresh — the timeline showed no
      // stars (CCRS#473 follow-up).
      await Promise.all([
        queryClient.invalidateQueries(["complaintDetails", tenantId, id]),
        queryClient.invalidateQueries("complaintsList"),
      ]);
      history.push(`${parentRoute}/response`);
    } catch (err) {
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  return (
    <ScreenContainer className="v2-pgr-rate">
      <div style={{ padding: "0.75rem 1.25rem 0 1.25rem", flexShrink: 0 }}>
        <ScreenHeader
          title={tr(t, "CS_COMPLAINT_RATE_HELP_TEXT", "How did we do?")}
          description={tr(
            t,
            "CS_COMPLAINT_RATE_SUBTEXT",
            "Your rating helps us improve. It only takes a moment."
          )}
        />
      </div>
      <div style={{ flex: "1 1 auto", padding: "1rem 1.25rem" }}>
        <Card className="p-6 space-y-6">
          <Field
            label={tr(t, "CS_COMPLAINT_RATE_TEXT", "Rate your experience")}
            required
          >
            <StarRow value={rating} onChange={setRating} />
            {submitError ? (
              <p
                role="alert"
                style={{
                  marginTop: 8,
                  fontSize: "0.8125rem",
                  color: "var(--color-error, #d4351c)",
                }}
              >
                {tr(
                  t,
                  "CS_FEEDBACK_ENTER_RATING_ERROR",
                  "Please pick a rating before submitting."
                )}
              </p>
            ) : null}
          </Field>

          <Field
            label={tr(t, "CS_FEEDBACK_WHAT_WAS_GOOD", "What was good?")}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "4px",
              }}
            >
              {FEEDBACK_KEYS.map((k) => (
                <FeedbackCheckbox
                  key={k}
                  checked={!!picks[k]}
                  onChange={(checked) =>
                    setPicks((prev) => ({ ...prev, [k]: checked }))
                  }
                  label={t(k)}
                />
              ))}
            </div>
          </Field>

          <Field label={tr(t, "CS_COMMON_COMMENTS", "Comments")} htmlFor="comments">
            <Textarea
              id="comments"
              placeholder={tr(
                t,
                "CS_RATING_COMMENTS_PLACEHOLDER",
                "Share anything else you'd like the team to know…"
              )}
              maxLength={1000}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </Field>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: "0.5rem",
            }}
          >
            <Button
              type="button"
              onClick={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              {tr(t, "CS_COMMON_SUBMIT", "Submit")}
            </Button>
          </div>
        </Card>
      </div>
    </ScreenContainer>
  );
};

export default SelectRating;
