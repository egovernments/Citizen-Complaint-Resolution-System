{{/*
Public hostname Gatus is served on. Explicit `ingress.host` wins; otherwise
`<subdomain>.<global.domain>` (e.g. status.cms-saas.digit.org).
*/}}
{{- define "gatus.host" -}}
{{- if .Values.ingress.host -}}
{{- .Values.ingress.host -}}
{{- else -}}
{{- printf "%s.%s" .Values.ingress.subdomain .Values.global.domain -}}
{{- end -}}
{{- end -}}
