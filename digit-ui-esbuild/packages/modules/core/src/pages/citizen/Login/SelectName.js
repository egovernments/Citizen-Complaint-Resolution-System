/* eslint-disable react/prop-types */
// New-user name step, on the card the number and OTP steps use. Same contract
// as the FormStep it replaces: `onSelect({ name })`, with the length and
// pattern rules taken from the step's config (Login/config.js), and the
// submit held while `isDisabled` (the registration call is in flight).

import React, { useMemo, useState } from "react";
import {
  Button as V2Button,
  Field as V2Field,
  Input as V2Input,
} from "@egovernments/digit-ui-components-v2";
import { SignInCard, V2LoginShell, stepText } from "./SelectMobileNumber";

const SelectName = ({ config, onSelect, t, isDisabled }) => {
  const input = config?.inputs?.[0] || {};
  const rules = input.validation || {};
  const pattern = useMemo(() => (rules.pattern ? new RegExp(rules.pattern) : null), [rules.pattern]);
  const [name, setName] = useState("");

  const tr = (key, fallback) => {
    const v = key ? t(key) : key;
    return v && v !== key ? v : fallback;
  };

  // Spaces at either end are a slip, not part of the name; the pattern would
  // otherwise reject "Kanav " for its trailing space.
  const value = name.trim();
  const isValid =
    value.length >= (rules.minlength || 1) &&
    (!rules.maxlength || value.length <= rules.maxlength) &&
    (!pattern || pattern.test(value));
  // Shown once something is typed, not on the empty field the step opens with.
  const error = value && !isValid ? tr(input.error, "Please enter a valid name") : null;

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!isValid || isDisabled) return;
    onSelect({ [input.name || "name"]: value });
  };

  return (
    <V2LoginShell>
      <SignInCard
        title={stepText(config?.texts?.header, "Your name")}
        text={stepText(config?.texts?.cardText, null)}
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <V2Field label={tr(input.label, "Name")} required={!!rules.required} htmlFor="register-name" error={error}>
            <V2Input
              id="register-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={rules.maxlength}
              invalid={!!error}
            />
          </V2Field>
          <V2Button type="submit" disabled={!isValid || isDisabled} loading={isDisabled} width="full">
            {stepText(config?.texts?.nextText, "Continue")}
          </V2Button>
        </form>
      </SignInCard>
    </V2LoginShell>
  );
};

export default SelectName;
