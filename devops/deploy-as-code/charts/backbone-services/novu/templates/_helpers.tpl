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

{{- /* spec.replicas for a Deployment with an optional HPA. Call with
       (dict "component" .Values.<api|worker|ws|dashboard> "root" $).
       Without an HPA: the configured count. Under the HPA the count is the
       HPA's, so render what is live: a fixed value would reset it on every
       upgrade, and leaving the field out would reset it once (Helm's
       three-way merge clears a field the old release set, so it defaults to
       1). Nothing live yet (first install, or `helm template` / --dry-run,
       where lookup returns nothing): leave it out and the HPA's minReplicas
       applies. */ -}}
{{- define "novu.replicas" -}}
{{- $c := .component -}}
{{- if not $c.autoscaling.enabled -}}
replicas: {{ $c.replicas }}
{{- else -}}
{{- $live := lookup "apps/v1" "Deployment" (include "novu.namespace" .root) $c.name -}}
{{- if and $live $live.spec.replicas -}}
replicas: {{ $live.spec.replicas }}
{{- end -}}
{{- end -}}
{{- end -}}
