<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "header">
        ${msg("digitProfileTitle")}
    <#elseif section = "form">
        <form id="kc-digit-profile-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="firstName" class="${properties.kcLabelClass!}">${msg("firstName")}</label>
                <input id="firstName" name="firstName" type="text" autocomplete="given-name" maxlength="100"
                       class="${properties.kcInputClass!}" value="${(firstName!"")}" autofocus required/>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <label for="lastName" class="${properties.kcLabelClass!}">${msg("lastName")}</label>
                <input id="lastName" name="lastName" type="text" autocomplete="family-name" maxlength="100"
                       class="${properties.kcInputClass!}" value="${(lastName!"")}"/>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <input id="kc-digit-profile-submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                       type="submit" value="${msg("digitContinue")}"/>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
