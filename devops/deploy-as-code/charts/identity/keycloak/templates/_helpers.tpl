{{- /* Public origin: identity.publicUrl, else https://<global.domain>
       (http:// on a quickstart cluster, as tenantless-redirect-ingress.yaml in
       the digit-ui chart decides it). No trailing slash. */ -}}
{{- define "keycloak.publicUrl" -}}
{{- $identity := .Values.identity | default dict -}}
{{- if $identity.publicUrl -}}
{{- trimSuffix "/" $identity.publicUrl -}}
{{- else -}}
{{- $global := .Values.global | default dict -}}
{{- $scheme := ternary "http" "https" (eq (toString $global.setup) "quickstart") -}}
{{- printf "%s://%s" $scheme (required "global.domain must be set" $global.domain) -}}
{{- end -}}
{{- end -}}

{{- define "keycloak.secretName" -}}
{{- .Values.secret.existingSecret | default (printf "%s-secrets" .Release.Name) -}}
{{- end -}}

{{- /* In-cluster base URL of this Keycloak (the Service), used by the
       configure Job's kcadm. Built by the same common helper identity-bff
       uses, from the shared identity.keycloak values, after checking those
       describe this chart's own Service: a mismatch would leave the BFF
       calling an address where Keycloak is not, with /readyz 503 and no
       sign-in, so it fails the render instead. */ -}}
{{- define "keycloak.serviceUrl" -}}
{{- $kc := (.Values.identity | default dict).keycloak | default dict -}}
{{- $name := include "common.name" . -}}
{{- if ne (toString $kc.service) $name -}}
{{- fail (printf "keycloak: identity.keycloak.service is %q but this chart's Service is %q. identity-bff reaches Keycloak through identity.keycloak; the identity helmfile sets it from identity.keycloak.name in env.yaml." (toString $kc.service) $name) -}}
{{- end -}}
{{- if ne (toString $kc.httpPort) (toString .Values.httpPort) -}}
{{- fail (printf "keycloak: identity.keycloak.httpPort is %v but httpPort is %v. identity-bff reaches Keycloak through identity.keycloak; the identity helmfile sets both from identity.keycloak.httpPort in env.yaml." $kc.httpPort .Values.httpPort) -}}
{{- end -}}
{{- if and $kc.namespace (ne (toString $kc.namespace) .Release.Namespace) -}}
{{- fail (printf "keycloak: identity.keycloak.namespace is %q but this release is in %q." (toString $kc.namespace) .Release.Namespace) -}}
{{- end -}}
{{- include "common.identity.keycloakUrl" . -}}
{{- end -}}

{{- /* Rolling tags get pullPolicy Always, as in common-services/novu-bridge:
       a node that already holds the image would otherwise keep running
       whatever the tag pointed at when it was first pulled. */ -}}
{{- define "keycloak.pullPolicy" -}}
{{- if regexMatch "^(latest|nightly-.*|develop|main|master)$" (toString .Values.image.tag) -}}
Always
{{- else -}}
{{- .Values.image.pullPolicy -}}
{{- end -}}
{{- end -}}
