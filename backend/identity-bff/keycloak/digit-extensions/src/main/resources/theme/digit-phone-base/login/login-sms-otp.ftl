<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "header">
        ${msg("digitOtpTitle")}
    <#elseif section = "form">
        <p id="digit-otp-sent-to">${msg("digitOtpSentTo", (maskedPhoneNumber!""))}</p>
        <form id="kc-digit-otp-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">${msg("digitOtpLabel")}</label>
                <input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code"
                       maxlength="${(otpLength!6)?c}" pattern="[0-9]*" class="${properties.kcInputClass!}" autofocus/>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <input id="kc-digit-otp-submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                       type="submit" value="${msg("doSubmit")}"/>
            </div>
        </form>
        <form id="kc-digit-otp-resend" action="${url.loginAction}" method="post">
            <input type="hidden" name="resend" value="true"/>
            <#if (resendAvailableInSeconds!0) gt 0>
                <button type="submit" id="kc-digit-otp-resend-button" class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!}"
                        disabled data-wait="${(resendAvailableInSeconds!0)?c}">${msg("digitResendIn", (resendAvailableInSeconds!0)?c)}</button>
                <script>
                    (function () {
                        var b = document.getElementById("kc-digit-otp-resend-button");
                        var s = parseInt(b.getAttribute("data-wait"), 10);
                        var t = setInterval(function () {
                            s -= 1;
                            if (s <= 0) { clearInterval(t); b.disabled = false; b.textContent = "${msg("digitResendOtp")?js_string}"; }
                            else { b.textContent = "${msg("digitResendIn", "__S__")?js_string}".replace("__S__", s); }
                        }, 1000);
                    })();
                </script>
            <#else>
                <button type="submit" id="kc-digit-otp-resend-button" class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!}">${msg("digitResendOtp")}</button>
            </#if>
        </form>
    </#if>
</@layout.registrationLayout>
