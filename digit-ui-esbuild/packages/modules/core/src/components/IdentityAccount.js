import { setCitizenDetail } from "./citizenSession";
import React, { useEffect, useRef, useState } from "react";
import { Redirect } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, Field, Input } from "@egovernments/digit-ui-components-v2";
import {
  IdentityAccount as api, isIdentityBffAuth, sendCitizenOtp, verifyCitizenOtp,
  establishIdentityBffSession,
} from "@egovernments/digit-ui-libraries";

const ACTIONS = {
  UPDATE_PASSWORD: "Set or update password",
  CONFIGURE_TOTP: "Set up an authenticator",
  UPDATE_EMAIL: "Change email address",
};
const fetchImpl = (...args) => window.fetch(...args);

// The session cache is per tab, while these legacy aliases are shared between
// tabs. Both must still belong to the person who opened the phone form.
const CITIZEN_SESSION_KEYS = ["Citizen.token", "Citizen.user-info", "token", "user-info", "citizen.userRequestObject", "Citizen.tenant-id", "tenant-id"];
const storedToken = (value) => {
  try { return JSON.parse(value); } catch (_) { return value; }
};
const capturePhoneSession = () => {
  const user = Digit.UserService.getUser();
  if (!user?.access_token || !user.info?.uuid || user.info.type !== "CITIZEN") return null;
  try {
    const aliases = CITIZEN_SESSION_KEYS.map((key) => [key, localStorage.getItem(key)]);
    // A different surface may already own the shared aliases on this browser.
    if (aliases.some(([key, value]) => ["Citizen.token", "token"].includes(key) && value !== null && storedToken(value) !== user.access_token)) return null;
    return { uuid: user.info.uuid, token: user.access_token, aliases };
  } catch (_) { return null; }
};

export const ChangePhone = ({ t, tenant, onChanged }) => {
  const [initialSession, setInitialSession] = useState(capturePhoneSession);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [mobileNumber, setMobileNumber] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const tr = (key, fallback) => t(key, { defaultValue: fallback });
  const ownsSession = () => {
    const current = Digit.UserService.getUser();
    if (!mounted.current || !initialSession || current?.info?.type !== "CITIZEN" ||
      current.info.uuid !== initialSession.uuid || current.access_token !== initialSession.token) return false;
    try { return initialSession.aliases.every(([key, value]) => localStorage.getItem(key) === value); }
    catch (_) { return false; }
  };
  const sessionChanged = () => ({ ok: false, messageKey: "CORE_IDENTITY_PHONE_SESSION_CHANGED",
    message: "Your signed-in account has changed. Reopen account settings before continuing." });
  const run = async (operation) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await operation();
      if (!result.ok) {
        setMessage(t(result.messageKey, { ...result.params, defaultValue: result.message }));
        if (result.retryAfter) setResendAt(Date.now() + result.retryAfter * 1000);
      }
      return result;
    } catch (_) {
      setMessage(tr("CORE_IDENTITY_UNAVAILABLE", "The phone change could not be completed. Please try again."));
    } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    if (!ownsSession()) return sessionChanged();
    if (Date.now() < resendAt) {
      return { ok: false, messageKey: "CORE_IDENTITY_OTP_RESEND_TOO_SOON", message: "Please wait before requesting another code." };
    }
    const result = await sendCitizenOtp({ mobileNumber, purpose: "change_phone", fetchImpl,
      locale: Digit.StoreData.getCurrentLanguage() });
    if (!ownsSession()) return sessionChanged();
    if (result.ok) {
      setChallenge(result);
      setCode("");
      setResendAt(Date.now() + result.resendAfter * 1000);
    }
    return result;
  });
  const verify = () => run(async () => {
    if (!ownsSession()) return sessionChanged();
    const result = await verifyCitizenOtp({ challengeId: challenge.challengeId, code, purpose: "change_phone", fetchImpl });
    if (!ownsSession()) return sessionChanged();
    if (result.ok) {
      // Re-select after the identifier change so local profile/token data comes
      // from the BFF, never from an unverified form value.
      const selected = await establishIdentityBffSession({ surface: "citizen", tenant, fetchImpl });
      if (!ownsSession() || (selected.status === "authenticated" && selected.user.info.uuid !== initialSession.uuid)) {
        return sessionChanged();
      }
      if (selected.status !== "authenticated") {
        setChallenge(null);
        setMessage(tr("CORE_IDENTITY_PHONE_CHANGED_SIGNIN", "Phone changed. Sign in again to refresh your account."));
        return result;
      }
      Digit.UserService.setUser(selected.user);
      Digit.SessionStorage.set("citizen.userRequestObject", selected.user);
      setCitizenDetail(selected.user.info, selected.user.access_token, tenant.tenantId);
      setInitialSession(capturePhoneSession());
      setChallenge(null);
      setMobileNumber("");
      setMessage(tr("CORE_IDENTITY_PHONE_CHANGED", "Your phone number has been changed."));
      onChanged();
    }
    return result;
  });
  return <Card style={{ padding: "24px", display: "grid", gap: "16px" }}>
    <h2>{tr("CORE_IDENTITY_CHANGE_PHONE", "Change phone number")}</h2>
    <p>{tr("CORE_IDENTITY_PHONE_HELP", "Enter the new number without the country code. We will send a verification code to it.")}</p>
    <Field label={tr("CORE_IDENTITY_NEW_PHONE", "New phone number")} htmlFor="account-phone">
      <Input id="account-phone" type="tel" inputMode="numeric" autoComplete="tel-national"
        value={mobileNumber} disabled={busy || !!challenge} onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))} />
    </Field>
    {challenge && <Field label={tr("CORE_IDENTITY_OTP_CODE", "Verification code")} htmlFor="account-code">
      <Input id="account-code" inputMode="numeric" autoComplete="one-time-code" value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
    </Field>}
    {message && <p role="status">{message}</p>}
    <Button type="button" disabled={busy || !mobileNumber || (!!challenge && !code)} onClick={challenge ? verify : send}>
      {challenge ? tr("CORE_IDENTITY_VERIFY_PHONE", "Verify and change phone") : tr("CORE_IDENTITY_SEND_CODE", "Send code")}
    </Button>
    {challenge && <>
      <Button type="button" variant="secondary" disabled={busy} onClick={send}>{tr("CORE_IDENTITY_RESEND", "Resend code")}</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => { setChallenge(null); setCode(""); }}>
        {tr("CORE_COMMON_CANCEL", "Cancel")}
      </Button>
    </>}
  </Card>;
};

// This route is entered explicitly from the account menu/profile. Nothing in
// the app shell fetches account metadata or waits for BFF availability.
const IdentityAccount = ({ surface }) => {
  const { t } = useTranslation();
  const [session, setSession] = useState(null);
  const [methods, setMethods] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tenant = window.__digitTenantContext;
  const tr = (key, fallback) => t(key, { defaultValue: fallback });
  const refresh = async () => {
    const data = await api.loadIdentityAccount({ surface, fetchImpl });
    setSession(data);
    if (data.account?.actions?.includes("idp_link")) {
      const catalogue = await api.accountRequest(fetchImpl, `/identity/v1/auth-methods?surface=${surface}&intent=signin`);
      setMethods(catalogue.methods || []);
    }
  };
  const run = async (operation) => {
    setBusy(true);
    setMessage("");
    try { await operation(); }
    catch (error) {
      const failure = api.identityMessage(error.code);
      setMessage(tr(failure.messageKey, failure.message));
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!tenant || !isIdentityBffAuth()) return;
    run(async () => {
      const url = new URL(window.location.href);
      const resultId = url.searchParams.get("authResult");
      if (resultId) {
        url.searchParams.delete("authResult");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
        const result = await api.accountRequest(fetchImpl, `/identity/v1/auth-results/${encodeURIComponent(resultId)}`);
        const notice = api.identityMessage(result.code);
        setMessage(tr(notice.messageKey, notice.message));
      }
      await refresh();
    });
  }, []);
  if (!tenant || !isIdentityBffAuth()) return <Redirect to={`/${window.contextPath}/${surface}/user/profile`} />;
  const action = (name, extra = {}) => run(() => {
    window.location.assign(api.buildAccountActionUrl({ surface, tenant, account: session.account,
      action: name, ...extra, returnTo: `${window.location.pathname}` }));
  });
  const logout = (scope) => run(async () => {
    try {
      await Digit.UserService.logout(scope);
    } catch (error) {
      if (scope !== "all") throw error;
      // This device is signed out locally; the others may not be.
      setMessage(tr("CORE_IDENTITY_LOGOUT_ALL_FAILED",
        "Signing out everywhere could not be confirmed. Other devices may still be signed in. Try again."));
      return;
    }
    if (scope === "others") {
      await refresh();
      setMessage(tr("CORE_IDENTITY_OTHER_SESSIONS_ENDED", "Your other sessions have been signed out."));
    }
  });
  return <main className="v2-scope" style={{ maxWidth: "720px", margin: "24px auto", display: "grid", gap: "20px" }} aria-busy={busy}>
    <h1>{tr("CORE_IDENTITY_ACCOUNT", "Account and security")}</h1>
    {message && <p role="status">{message}</p>}
    {!session && <Button type="button" disabled={busy} onClick={() => run(refresh)}>{tr("CORE_IDENTITY_TRY_AGAIN", "Try again")}</Button>}
    {session && <>
      <Card style={{ padding: "24px", display: "grid", gap: "16px" }}>
        <p>{session.user?.email || session.user?.phoneNumber}</p>
        {Object.entries(ACTIONS).filter(([name]) => session.account?.actions?.includes(name)).map(([name, label]) =>
          <Button key={name} type="button" disabled={busy} onClick={() => action(name)}>{tr(`CORE_IDENTITY_${name}`, label)}</Button>)}
        {session.account?.actions?.includes("delete_credential") && session.account.credentials?.filter((c) =>
          ["otp", "webauthn"].includes(c.type)).map((c) =>
          <Button key={c.id} type="button" disabled={busy} onClick={() => action("delete_credential", { credentialId: c.id })}>
            {tr("CORE_IDENTITY_REMOVE_FACTOR", "Remove second factor")}: {c.label || c.type}
          </Button>)}
        {session.account?.actions?.includes("idp_link") && api.availableProviders(methods, session.account).map((provider) =>
          <Button key={provider.id} type="button" disabled={busy} onClick={() => action("idp_link", { provider: provider.idpHint })}>
            {tr("CORE_IDENTITY_LINK_PROVIDER", "Link provider")}: {provider.label || provider.id}
          </Button>)}
        {session.account?.providers?.map((provider) => <Button key={provider.alias} type="button" disabled={busy}
          onClick={() => run(async () => { await api.unlinkIdentityProvider({ surface, alias: provider.alias, fetchImpl }); await refresh(); })}>
          {tr("CORE_IDENTITY_UNLINK_PROVIDER", "Unlink provider")}: {provider.alias}
        </Button>)}
      </Card>
      {surface === "citizen" && <ChangePhone t={t} tenant={tenant} onChanged={() => run(refresh)} />}
      <Card style={{ padding: "24px", display: "grid", gap: "16px" }}>
        <h2>{tr("CORE_IDENTITY_SESSIONS", "Signed-in sessions")}</h2>
        <ul>{session.sessions?.map((item) => <li key={item.id}>
          {item.surface} {item.current ? tr("CORE_IDENTITY_CURRENT_SESSION", "(this session)") : ""}
          {item.lastSeenAt ? ` — ${new Date(item.lastSeenAt).toLocaleString()}` : ""}
        </li>)}</ul>
        <Button type="button" disabled={busy} onClick={() => logout("others")}>{tr("CORE_IDENTITY_LOGOUT_OTHERS", "Sign out other sessions")}</Button>
        <Button type="button" disabled={busy} onClick={() => logout("all")}>{tr("CORE_IDENTITY_LOGOUT_ALL", "Sign out everywhere")}</Button>
        <Button type="button" disabled={busy} onClick={() => logout("current")}>{tr("CORE_COMMON_LOGOUT", "Sign out")}</Button>
      </Card>
    </>}
  </main>;
};

export default IdentityAccount;
