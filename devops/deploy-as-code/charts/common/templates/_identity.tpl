{{- /* Helpers shared by the identity charts (charts/identity/keycloak and
       charts/identity/identity-bff), so the contracts between them are one
       definition instead of two copies kept in step by hand. */ -}}

{{- /* In-cluster base URL of the identity stack's Keycloak Service, from the
       shared identity.keycloak values (service, namespace, httpPort) that
       charts/identity/identity-helmfile.yaml passes to both releases. Empty
       namespace = this release's namespace. The keycloak chart refuses values
       that do not match its own Service (keycloak.serviceUrl), so the BFF
       cannot be pointed somewhere Keycloak is not. */ -}}
{{- define "common.identity.keycloakUrl" -}}
{{- $kc := (.Values.identity | default dict).keycloak | default dict -}}
{{- printf "http://%s.%s:%v" (required "identity.keycloak.service must be set" $kc.service) ($kc.namespace | default .Release.Namespace) (required "identity.keycloak.httpPort must be set" $kc.httpPort) -}}
{{- end -}}

{{- /* Public origin of the deployment: identity.publicUrl, else
       https://<global.domain> (http:// on a quickstart cluster, as
       tenantless-redirect-ingress.yaml in the digit-ui chart decides it). No
       trailing slash. Keycloak's KC_HOSTNAME and its clients' redirect URIs
       and the BFF's issuer and redirect URI are all built from it. */ -}}
{{- define "common.identity.publicUrl" -}}
{{- $identity := .Values.identity | default dict -}}
{{- if $identity.publicUrl -}}
{{- trimSuffix "/" $identity.publicUrl -}}
{{- else -}}
{{- $global := .Values.global | default dict -}}
{{- $scheme := ternary "http" "https" (eq (toString $global.setup) "quickstart") -}}
{{- printf "%s://%s" $scheme (required "global.domain must be set" $global.domain) -}}
{{- end -}}
{{- end -}}
