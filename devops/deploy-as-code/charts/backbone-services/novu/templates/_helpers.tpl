{{- define "novu.namespace" -}}
{{- default .Release.Namespace .Values.namespace -}}
{{- end }}

{{- /* Name of the Secret holding the signing/encryption keys: an
       out-of-band one when novu.secrets.existingSecret is set, otherwise the
       one templates/secret.yaml creates. Defined once so the Secret and every
       secretKeyRef that reads it cannot drift apart. */ -}}
{{- define "novu.secretName" -}}
{{- default (printf "%s-secrets" .Release.Name) .Values.novu.secrets.existingSecret -}}
{{- end -}}
