<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "header">
        ${msg("digitPhoneTitle")}
    <#elseif section = "form">
        <form id="kc-digit-phone-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="phoneNumber" class="${properties.kcLabelClass!}">${msg("digitPhoneLabel")}</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <span id="digit-country-code">${countryCode!""}</span>
                    <input id="phoneNumber" name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel-national"
                           class="${properties.kcInputClass!}" value="${(phoneNumber!"")}" autofocus required
                           data-pattern="${(mobileNumberRegex!"")}" aria-describedby="digit-phone-hint"/>
                </div>
                <#if digitTenant??><input type="hidden" id="digit-tenant" value="${digitTenant}"/></#if>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <input id="kc-digit-phone-submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                       type="submit" value="${msg("digitContinue")}"/>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
