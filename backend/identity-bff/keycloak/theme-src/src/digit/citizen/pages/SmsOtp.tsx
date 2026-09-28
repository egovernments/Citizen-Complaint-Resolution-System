import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { KcContext } from "../../../login/KcContext";
import { useBranding } from "../../branding/BrandingContext";
import { spiMessageKey, type DigitPageProps } from "../../shared/kc";

const RESEND_SECONDS = 30;

/**
 * pages/citizen/Login/SelectOtp.js OtpBoxes: one box per digit, auto-advance,
 * backspace/arrow navigation, paste of the whole code anywhere in the group,
 * and `one-time-code` on the first box for SMS autofill. The boxes are only
 * the display: the code posts as the single `otp` field Keycloak reads.
 */
function OtpBoxes(props: { length: number; value: string; onChange: (value: string) => void; invalid: boolean }) {
    const { length, value, onChange, invalid } = props;
    const inputs = useRef<(HTMLInputElement | null)[]>([]);
    const chars = value.split("").concat(new Array(length).fill("")).slice(0, length);

    useEffect(() => {
        inputs.current[0]?.focus();
    }, []);

    const handleInput = (index: number, raw: string) => {
        let digits = raw.replace(/\D/g, "");
        // Typing into a filled box (the first one accepts a whole code, for
        // autofill) leaves the old digit beside the new one: replace it
        // rather than treating the pair as a paste that clears the rest.
        const previous = chars[index];
        if (digits.length === 2 && previous && digits.includes(previous)) {
            digits = digits.startsWith(previous) ? digits.slice(1) : digits.slice(0, 1);
        }
        // Autofill (one-time-code) and some keyboards deliver the whole code
        // into one box; treat that as a paste.
        if (digits.length > 1) {
            const next = digits.slice(0, length);
            onChange(next);
            inputs.current[Math.min(next.length, length) - 1]?.focus();
            return;
        }
        const next = chars.slice();
        next[index] = digits.slice(-1);
        onChange(next.join("").slice(0, length));
        if (digits && index < length - 1) inputs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Backspace" && !chars[index] && index > 0) {
            inputs.current[index - 1]?.focus();
        } else if (event.key === "ArrowLeft" && index > 0) {
            inputs.current[index - 1]?.focus();
        } else if (event.key === "ArrowRight" && index < length - 1) {
            inputs.current[index + 1]?.focus();
        }
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
        const text = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, length);
        if (!text) return;
        event.preventDefault();
        onChange(text);
        inputs.current[Math.min(text.length, length) - 1]?.focus();
    };

    return (
        <div
            className="dg-otp"
            role="group"
            aria-label="One-time password"
            onPaste={handlePaste}
            style={{ ["--dg-otp-length" as string]: String(length) }}
        >
            {Array.from({ length }).map((_, index) => (
                <input
                    key={index}
                    ref={element => {
                        inputs.current[index] = element;
                    }}
                    className="dg-otp__box"
                    type="tel"
                    inputMode="numeric"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={index === 0 ? length : 1}
                    aria-label={`Digit ${index + 1}`}
                    value={chars[index]}
                    aria-invalid={invalid || undefined}
                    onChange={event => handleInput(index, event.target.value)}
                    onKeyDown={event => handleKeyDown(index, event)}
                />
            ))}
        </div>
    );
}

/**
 * login-sms-otp.ftl: pages/citizen/Login/SelectOtp.js.
 *
 * Continue posts `otp`; "Resend OTP" posts `resend=true` once the countdown
 * (Keycloak's `resendAvailableInSeconds`, else the legacy 30s) has run out.
 * A wrong code shows the legacy CS_INVALID_OTP line under the boxes; other
 * authenticator errors raise the legacy toast.
 */
export default function SmsOtp(props: DigitPageProps<Extract<KcContext, { pageId: "login-sms-otp.ftl" }>>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, message, messagesPerField } = kcContext;
    const { i18n: digit } = useBranding();

    const length = kcContext.otpLength && kcContext.otpLength > 0 ? kcContext.otpLength : 6;
    const messageKey = spiMessageKey(message?.summary, i18n);
    const invalid = messagesPerField.existsError("otp") || messageKey === "digitInvalidOtp";

    const [otp, setOtp] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [timeLeft, setTimeLeft] = useState(() =>
        typeof kcContext.resendAvailableInSeconds === "number" ? Math.max(0, kcContext.resendAvailableInSeconds) : RESEND_SECONDS
    );

    useEffect(() => {
        if (timeLeft <= 0) return;
        const timer = setTimeout(() => setTimeLeft(value => value - 1), 1000);
        return () => clearTimeout(timer);
    }, [timeLeft]);

    const isReady = otp.length === length && !isSubmitting;
    const lede = digit.has("CS_LOGIN_OTP_TEXT")
        ? `${digit.t("CS_LOGIN_OTP_TEXT")} ${kcContext.maskedPhoneNumber ?? ""}`.trim()
        : digit.t("CS_LOGIN_OTP_TEXT");
    const seconds = digit.has("CS_RESEND_SECONDS") ? ` ${digit.t("CS_RESEND_SECONDS")}` : "s";

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!invalid}
            headerNode={digit.t("CS_LOGIN_OTP")}
            lede={lede}
        >
            <div className="dg-form dg-form--citizen" style={{ gap: 20 }}>
                <form
                    id="kc-otp-form"
                    className="dg-form dg-form--citizen"
                    action={url.loginAction}
                    method="post"
                    noValidate
                    onSubmit={event => {
                        if (!isReady) {
                            event.preventDefault();
                            return;
                        }
                        setIsSubmitting(true);
                    }}
                >
                    <OtpBoxes length={length} value={otp} onChange={setOtp} invalid={invalid} />
                    <input type="hidden" name="otp" value={otp} />
                    {invalid && (
                        <p role="alert" className="dg-otp-error" id="otp-error">
                            {digit.t("CS_INVALID_OTP")}
                        </p>
                    )}
                    <button className="dg-button" id="kc-login" type="submit" disabled={!isReady}>
                        {isSubmitting && <span className="dg-spinner" aria-hidden="true" />}
                        {digit.t("CS_COMMONS_NEXT")}
                    </button>
                </form>

                <div className="dg-resend" aria-live="polite">
                    {timeLeft > 0 ? (
                        <span id="otp-resend-countdown">
                            {digit.t("CS_RESEND_ANOTHER_OTP")} {timeLeft}
                            {seconds}
                        </span>
                    ) : (
                        <form id="kc-otp-resend-form" action={url.loginAction} method="post">
                            <input type="hidden" name="resend" value="true" />
                            <button type="submit" id="otp-resend" className="dg-resend__button">
                                {digit.t("CS_RESEND_OTP")}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </Template>
    );
}
