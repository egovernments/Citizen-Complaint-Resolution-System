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
       configure Job's kcadm. */ -}}
{{- define "keycloak.serviceUrl" -}}
{{- printf "http://%s.%s:%v" (include "common.name" .) .Release.Namespace .Values.httpPort -}}
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
