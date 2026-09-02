{{/*
Public hostname Gatus is served on. Explicit `ingress.host` wins; otherwise the
main `global.domain` (Gatus lives under `ingress.path`, e.g.
cms-saas.digit.org/status).
*/}}
{{- define "gatus.host" -}}
{{- if .Values.ingress.host -}}
{{- .Values.ingress.host -}}
{{- else -}}
{{- .Values.global.domain -}}
{{- end -}}
{{- end -}}
